import asyncio
import concurrent.futures
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

from app.trusted_season import (
    EvidenceSigner,
    EvidenceStore,
    LeaseLostError,
    TrustedConfig,
    TrustedSeasonRuntime,
    TrustedSeasonWorker,
    build_manifest,
    canonical_json,
    execute_trusted_run,
    sha256_text,
)


CONFIG_JSON = json.dumps({
    "providers": [{"id": "official", "base_url": "https://api.example.com/v1/", "api_key": "test-only-secret"}],
    "candidates": [
        {"provider_id": "official", "model": "model-a", "input_usd_per_token": 0.000001, "output_usd_per_token": 0.000002},
        {"provider_id": "official", "model": "model-b", "input_usd_per_token": 0.000003, "output_usd_per_token": 0.000004},
    ],
    "judge": {"provider_id": "official", "model": "judge-model"},
    "concurrency": 2,
})


class TrustedSeasonTests(unittest.TestCase):
    def test_manifest_freezes_public_configuration_without_endpoint_or_key(self):
        config = TrustedConfig.from_json(CONFIG_JSON)
        self.assertIsNotNone(config)
        manifest = build_manifest(config, "run-salt", "local-e2e", True)
        serialized = canonical_json(manifest)
        self.assertNotIn("api.example.com", serialized)
        self.assertNotIn("test-only-secret", serialized)
        self.assertEqual(manifest["execution"]["case_concurrency"], 2)
        self.assertEqual(len(manifest["dataset"]), 8)
        self.assertEqual(manifest["environment"], "local-e2e")
        self.assertTrue(manifest["simulated"])

    def test_ed25519_signature_detects_report_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            signer = EvidenceSigner(Path(directory) / "signing.key")
            evidence_hash = sha256_text('{"run":"one"}')
            signature = signer.sign_hash(evidence_hash)
            self.assertTrue(EvidenceSigner.verify(evidence_hash, signature, signer.public_key_base64))
            self.assertFalse(EvidenceSigner.verify(sha256_text('{"run":"two"}'), signature, signer.public_key_base64))

    def test_evidence_and_audit_rows_are_immutable(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory) / "evidence.sqlite3")
            signer = EvidenceSigner(Path(directory) / "signing.key")
            store.create_run("run-one", "manifest", "local-e2e", True)
            store.save_evidence("run-one", {"run_id": "run-one"}, signer)
            self.assertTrue(store.verify_audit_chain())
            with self.assertRaises(sqlite3.IntegrityError):
                with store.connect() as connection:
                    connection.execute("UPDATE immutable_evidence SET evidence_hash='changed'")
            with self.assertRaises(sqlite3.IntegrityError):
                with store.connect() as connection:
                    connection.execute("DELETE FROM audit_events")

    def test_concurrent_audit_appends_remain_a_single_valid_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory) / "evidence.sqlite3")
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                futures = [executor.submit(store.append_audit, "run-concurrent", "case.completed", {"index": index}) for index in range(24)]
                for future in futures:
                    future.result()
            self.assertTrue(store.verify_audit_chain())
            self.assertEqual(len(store.audit_for_run("run-concurrent")), 24)

    def test_evidence_review_and_publication_writes_rollback_when_audit_insert_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "evidence.sqlite3")
            signer = EvidenceSigner(data_dir / "signing.key")
            report = {
                "manifest": {"environment": "official", "simulated": False},
                "results": [{"case_id": "copy-01", "review_required": True}],
                "ranking": [{"model": "model-a", "average_score": 90}],
            }
            store.create_run("run-atomic", "manifest", "official", False)

            with store.connect() as connection:
                connection.execute("CREATE TRIGGER fail_evidence_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='evidence.sealed' BEGIN SELECT RAISE(ABORT, 'audit failure'); END")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "audit failure"):
                store.save_evidence("run-atomic", report, signer)
            self.assertIsNone(store.get_evidence("run-atomic"))
            self.assertIsNone(store.get_run("run-atomic")["evidence_id"])

            with store.connect() as connection:
                connection.execute("DROP TRIGGER fail_evidence_audit")
            store.save_evidence("run-atomic", report, signer)
            store.update_run("run-atomic", status="completed")

            with store.connect() as connection:
                connection.execute("CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='review.recorded' BEGIN SELECT RAISE(ABORT, 'audit failure'); END")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "audit failure"):
                store.add_review_decisions("run-atomic", [{"case_id": "copy-01", "decision": "confirmed"}], "reviewer-hash")
            self.assertEqual(store.list_reviews("run-atomic"), [])

            with store.connect() as connection:
                connection.execute("DROP TRIGGER fail_review_audit")
            store.add_review_decisions("run-atomic", [{"case_id": "copy-01", "decision": "confirmed"}], "reviewer-hash")

            with store.connect() as connection:
                connection.execute("CREATE TRIGGER fail_publication_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='leaderboard.published' BEGIN SELECT RAISE(ABORT, 'audit failure'); END")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "audit failure"):
                store.publish_run("run-atomic", "publisher-hash", {"verified": True})
            self.assertEqual(store.list_publications(), [])

            with store.connect() as connection:
                connection.execute("DROP TRIGGER fail_publication_audit")
            store.publish_run("run-atomic", "publisher-hash", {"verified": True})
            event_types = [item["event_type"] for item in store.audit_for_run("run-atomic")]
            self.assertLess(event_types.index("review.recorded"), event_types.index("leaderboard.published"))
            self.assertTrue(store.verify_audit_chain())

    def test_full_run_seals_verifiable_evidence_without_raw_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            config = TrustedConfig.from_json(CONFIG_JSON)
            store = EvidenceStore(Path(directory) / "evidence.sqlite3")
            signer = EvidenceSigner(Path(directory) / "signing.key")
            manifest = build_manifest(config, "run-salt", "staging", False)
            store.create_run("run-full", sha256_text(canonical_json(manifest)), "staging", False)

            def fake_provider(_provider, model, content, _temperature, _timeout):
                if model == "judge-model":
                    return {
                        "content": json.dumps({"winner": "A", "confidence": 0.86, "scores": [{"alias": "A", "total": 91}, {"alias": "B", "total": 83}]}),
                        "latency_ms": 12,
                        "input_tokens": 20,
                        "output_tokens": 10,
                    }
                return {"content": f"private output {model}: {content}", "latency_ms": 25, "input_tokens": 30, "output_tokens": 15}

            asyncio.run(execute_trusted_run("run-full", config, manifest, store, signer, fake_provider))
            run = store.get_run("run-full")
            evidence = store.get_evidence("run-full")
            self.assertEqual(run["status"], "completed")
            self.assertEqual(run["completed_cases"], 8)
            self.assertTrue(EvidenceSigner.verify(evidence["evidence_hash"], evidence["signature"], evidence["public_key"]))
            self.assertTrue(store.verify_audit_chain())
            serialized = canonical_json(evidence["report"])
            self.assertNotIn("private output", serialized)
            self.assertNotIn("test-only-secret", serialized)
            self.assertEqual(evidence["report"]["summary"]["failed_attempts"], 0)
            self.assertEqual(evidence["report"]["manifest"]["environment"], "staging")
            self.assertFalse(evidence["report"]["manifest"]["simulated"])

    def test_expired_worker_lease_is_requeued_instead_of_failed_on_api_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            store.create_run("run-interrupted", "manifest", "local-e2e", True)
            store.enqueue_job("run-interrupted", {"schema_version": "m3.3"})
            claimed = store.claim_job("worker-a", 30)
            self.assertEqual(claimed["run_id"], "run-interrupted")
            with store.connect() as connection:
                connection.execute("UPDATE trusted_jobs SET lease_expires_at='2020-01-01T00:00:00+00:00' WHERE run_id='run-interrupted'")
            recovered = store.recover_stale_jobs()
            self.assertEqual(recovered["recovered"], ["run-interrupted"])
            self.assertEqual(store.get_run("run-interrupted")["status"], "queued")
            self.assertEqual(store.claim_job("worker-b", 30)["attempts"], 2)

    def test_stale_worker_attempt_cannot_seal_or_fail_reclaimed_run(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            signer = EvidenceSigner(data_dir / "signing.key")
            store.create_run("run-overlap", "manifest", "local-e2e", True)
            store.enqueue_job("run-overlap", {"schema_version": "m3.3"})
            first = store.claim_job("worker-a", 30)
            with store.connect() as connection:
                connection.execute("UPDATE trusted_jobs SET lease_expires_at='2020-01-01T00:00:00+00:00' WHERE run_id='run-overlap'")
            store.recover_stale_jobs()
            second = store.claim_job("worker-b", 30)
            with self.assertRaises(LeaseLostError):
                store.update_run_for_claim("run-overlap", "worker-a", first["attempts"], completed_cases=1)
            report = {
                "completed_at": "2026-01-01T00:00:00+00:00",
                "summary": {"total_cases": 8},
                "ranking": [],
            }
            barrier = threading.Barrier(2)

            def seal(worker_id, attempt):
                barrier.wait()
                try:
                    evidence, created = store.seal_evidence_for_claim("run-overlap", report, signer, worker_id, attempt)
                    return {"evidence_hash": evidence["evidence_hash"], "created": created}
                except LeaseLostError:
                    return {"lease_lost": True}

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                stale_future = executor.submit(seal, "worker-a", first["attempts"])
                current_future = executor.submit(seal, "worker-b", second["attempts"])
                stale_result = stale_future.result()
                current_result = current_future.result()
            self.assertTrue(current_result["created"])
            self.assertTrue(stale_result.get("lease_lost") or stale_result.get("created") is False)
            if "evidence_hash" in stale_result:
                self.assertEqual(stale_result["evidence_hash"], current_result["evidence_hash"])
            self.assertFalse(store.fail_claim("run-overlap", "worker-a", first["attempts"], "IntegrityError: duplicate"))
            self.assertEqual(store.get_run("run-overlap")["status"], "completed")
            self.assertEqual(store.get_job("run-overlap")["status"], "completed")

    def test_worker_treats_entry_lease_loss_as_normal_and_continues_to_next_job(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            config = TrustedConfig.from_json(CONFIG_JSON)
            worker = TrustedSeasonWorker(data_dir, config, "worker-stale")
            manifest = build_manifest(config, worker.configuration_salt, "local-e2e", True)
            worker.store.create_run("run-stale-start", sha256_text(canonical_json(manifest)), "local-e2e", True)
            worker.store.enqueue_job("run-stale-start", manifest)
            stale_job = worker.store.claim_job(worker.worker_id, 30)
            with worker.store.connect() as connection:
                connection.execute("UPDATE trusted_jobs SET lease_expires_at='2020-01-01T00:00:00+00:00' WHERE run_id='run-stale-start'")
            worker.store.recover_stale_jobs()
            replacement = worker.store.claim_job("worker-replacement", 30)
            self.assertEqual(replacement["attempts"], stale_job["attempts"] + 1)

            def fake_provider(_provider, model, _content, _temperature, _timeout):
                if model == "judge-model":
                    return {"content": json.dumps({"winner": "A", "confidence": 0.9, "scores": [{"alias": "A", "total": 90}, {"alias": "B", "total": 80}]}), "latency_ms": 1, "input_tokens": 10, "output_tokens": 5}
                return {"content": f"private {model}", "latency_ms": 2, "input_tokens": 10, "output_tokens": 5}

            asyncio.run(worker.process_job(stale_job, fake_provider))
            self.assertEqual(worker.store.get_job("run-stale-start")["lease_owner"], "worker-replacement")

            worker.store.create_run("run-next", sha256_text(canonical_json(manifest)), "local-e2e", True)
            worker.store.enqueue_job("run-next", manifest)
            self.assertTrue(asyncio.run(worker.run_once(fake_provider)))
            self.assertEqual(worker.store.get_run("run-next")["status"], "completed")

    def test_persistent_worker_claims_job_and_seals_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            config = TrustedConfig.from_json(CONFIG_JSON)
            worker = TrustedSeasonWorker(data_dir, config, "worker-test")
            manifest = build_manifest(config, worker.configuration_salt, "local-e2e", True)
            worker.store.create_run("run-worker", sha256_text(canonical_json(manifest)), "local-e2e", True)
            worker.store.enqueue_job("run-worker", manifest)

            def fake_provider(_provider, model, _content, _temperature, _timeout):
                if model == "judge-model":
                    return {"content": json.dumps({"winner": "A", "confidence": 0.9, "scores": [{"alias": "A", "total": 90}, {"alias": "B", "total": 80}]}), "latency_ms": 1, "input_tokens": 10, "output_tokens": 5}
                return {"content": f"private {model}", "latency_ms": 2, "input_tokens": 10, "output_tokens": 5}

            self.assertTrue(asyncio.run(worker.run_once(fake_provider)))
            self.assertEqual(worker.store.get_run("run-worker")["status"], "completed")
            self.assertEqual(worker.store.get_job("run-worker")["status"], "completed")
            self.assertEqual(worker.store.latest_worker()["state"], "idle")
            self.assertTrue(worker.store.get_evidence("run-worker"))

    def test_review_decisions_are_append_only_and_gate_official_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            signer = EvidenceSigner(data_dir / "signing.key")
            store.create_run("run-official", "manifest", "official", False)
            report = {
                "manifest": {"environment": "official", "simulated": False},
                "results": [{"case_id": "copy-01", "review_required": True}],
                "ranking": [{"model": "model-a", "average_score": 90}],
            }
            store.save_evidence("run-official", report, signer)
            store.update_run("run-official", status="completed", completed_at="2026-01-01T00:00:00+00:00")
            evidence = store.get_evidence("run-official")
            verification = {
                "verified": EvidenceSigner.verify(evidence["evidence_hash"], evidence["signature"], evidence["public_key"]),
            }
            self.assertIn("required_reviews_unresolved", store.publication_eligibility("run-official", verification)["reasons"])
            reviews = store.add_review_decisions("run-official", [{"case_id": "copy-01", "decision": "confirmed", "note": "checked"}], "reviewer-hash")
            self.assertEqual(reviews[0]["decision"], "confirmed")
            publication = store.publish_run("run-official", "publisher-hash", verification)
            self.assertEqual(publication["run_id"], "run-official")
            self.assertEqual(publication["review_snapshot_hash"], store.review_snapshot_hash("run-official"))
            self.assertEqual(store.list_publications()[0]["review_snapshot_hash"], publication["review_snapshot_hash"])
            with self.assertRaisesRegex(ValueError, "published run reviews are locked"):
                store.add_review_decisions("run-official", [{"case_id": "copy-01", "decision": "needs_followup"}], "reviewer-hash")
            with self.assertRaises(sqlite3.IntegrityError):
                with store.connect() as connection:
                    connection.execute("DELETE FROM review_decisions")
            with self.assertRaises(sqlite3.IntegrityError):
                with store.connect() as connection:
                    connection.execute("UPDATE season_publications SET publication_hash='changed'")

    def test_overturned_required_review_remains_unresolved_without_corrected_ranking(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            signer = EvidenceSigner(data_dir / "signing.key")
            store.create_run("run-overturned", "manifest", "official", False)
            store.save_evidence("run-overturned", {
                "manifest": {"environment": "official", "simulated": False},
                "results": [{"case_id": "copy-01", "review_required": True}],
                "ranking": [{"model": "model-a", "average_score": 90}],
            }, signer)
            store.update_run("run-overturned", status="completed")
            store.add_review_decisions("run-overturned", [{"case_id": "copy-01", "decision": "overturned"}], "reviewer-hash")
            eligibility = store.publication_eligibility("run-overturned", {"verified": True})
            self.assertFalse(eligibility["eligible"])
            self.assertIn("required_reviews_unresolved", eligibility["reasons"])
            with self.assertRaisesRegex(ValueError, "required_reviews_unresolved"):
                store.publish_run("run-overturned", "publisher-hash", {"verified": True})

    def test_publication_and_followup_review_are_serialized_without_reopening_a_published_run(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            signer = EvidenceSigner(data_dir / "signing.key")
            store.create_run("run-publish-race", "manifest", "official", False)
            store.save_evidence("run-publish-race", {
                "manifest": {"environment": "official", "simulated": False},
                "results": [{"case_id": "copy-01", "review_required": True}],
                "ranking": [{"model": "model-a", "average_score": 90}],
            }, signer)
            store.update_run("run-publish-race", status="completed")
            store.add_review_decisions("run-publish-race", [{"case_id": "copy-01", "decision": "confirmed"}], "reviewer-hash")
            barrier = threading.Barrier(2)

            def publish():
                barrier.wait()
                try:
                    store.publish_run("run-publish-race", "publisher-hash", {"verified": True})
                    return "published"
                except ValueError as error:
                    return str(error)

            def reopen_review():
                barrier.wait()
                try:
                    store.add_review_decisions("run-publish-race", [{"case_id": "copy-01", "decision": "needs_followup"}], "reviewer-hash")
                    return "reviewed"
                except ValueError as error:
                    return str(error)

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                publish_future = executor.submit(publish)
                review_future = executor.submit(reopen_review)
                publish_result = publish_future.result()
                review_result = review_future.result()
            publications = store.list_publications()
            latest = store.latest_reviews("run-publish-race")["copy-01"]["decision"]
            if publications:
                self.assertEqual(publish_result, "published")
                self.assertIn("published run reviews are locked", review_result)
                self.assertEqual(latest, "confirmed")
            else:
                self.assertEqual(review_result, "reviewed")
                self.assertIn("required_reviews_unresolved", publish_result)
                self.assertEqual(latest, "needs_followup")

    def test_simulated_or_non_official_runs_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory) / "evidence.sqlite3")
            signer = EvidenceSigner(Path(directory) / "signing.key")
            store.create_run("run-local", "manifest", "local-e2e", True)
            store.save_evidence("run-local", {"manifest": {"environment": "local-e2e", "simulated": True}, "results": [], "ranking": []}, signer)
            store.update_run("run-local", status="completed")
            eligibility = store.publication_eligibility("run-local", {"verified": True})
            self.assertFalse(eligibility["eligible"])
            self.assertIn("official_environment_required", eligibility["reasons"])
            self.assertIn("non_simulated_evidence_required", eligibility["reasons"])

    def test_start_authorization_requires_admin_or_explicit_local_loopback_bypass(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = TrustedSeasonRuntime(Path(directory), None)
            runtime.admin_token = "admin-secret"
            self.assertTrue(runtime.start_authorized("admin-secret", "203.0.113.10"))
            self.assertTrue(runtime.admin_authorized("admin-secret"))
            self.assertFalse(runtime.start_authorized("wrong", "127.0.0.1"))
            runtime.admin_token = ""
            runtime.environment = "local-e2e"
            runtime.local_e2e_bypass = True
            self.assertTrue(runtime.start_authorized("", "127.0.0.1"))
            self.assertFalse(runtime.start_authorized("", "203.0.113.10"))
            runtime.environment = "official"
            self.assertFalse(runtime.start_authorized("", "127.0.0.1"))
            runtime.admin_token = "admin-secret"
            runtime.reviewer_token = "review-secret"
            self.assertTrue(runtime.review_authorized("review-secret"))
            self.assertTrue(runtime.review_authorized("admin-secret"))


if __name__ == "__main__":
    unittest.main()
