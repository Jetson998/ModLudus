import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.trusted_season import (
    EvidenceSigner,
    EvidenceStore,
    TrustedConfig,
    TrustedSeasonRuntime,
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

    def test_api_restart_closes_unrecoverable_in_process_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            store = EvidenceStore(data_dir / "trusted-season.sqlite3")
            store.create_run("run-interrupted", "manifest", "local-e2e", True)
            store.update_run("run-interrupted", status="running", started_at="2026-01-01T00:00:00+00:00")
            runtime = TrustedSeasonRuntime(data_dir, None)
            run = runtime.store.get_run("run-interrupted")
            self.assertEqual(run["status"], "failed")
            self.assertEqual(run["error"], "api_restart_interrupted")
            self.assertEqual(runtime.store.audit_for_run("run-interrupted")[-1]["event_type"], "run.interrupted")

    def test_start_authorization_requires_admin_or_explicit_local_loopback_bypass(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = TrustedSeasonRuntime(Path(directory), None)
            runtime.admin_token = "admin-secret"
            self.assertTrue(runtime.start_authorized("admin-secret", "203.0.113.10"))
            self.assertFalse(runtime.start_authorized("wrong", "127.0.0.1"))
            runtime.admin_token = ""
            runtime.environment = "local-e2e"
            runtime.local_e2e_bypass = True
            self.assertTrue(runtime.start_authorized("", "127.0.0.1"))
            self.assertFalse(runtime.start_authorized("", "203.0.113.10"))
            runtime.environment = "official"
            self.assertFalse(runtime.start_authorized("", "127.0.0.1"))


if __name__ == "__main__":
    unittest.main()
