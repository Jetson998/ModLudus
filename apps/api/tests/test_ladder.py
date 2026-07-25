import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.ladder import (
    ARTIFICIAL_ANALYSIS_SOURCE,
    OPENROUTER_SOURCE,
    LadderService,
    LadderSnapshotStore,
    parse_artificial_analysis_html,
    parse_openrouter_payload,
)


def openrouter_model(index=0, name="OpenAI: GPT-5.6 Sol", model_id="openai/gpt-5.6-sol"):
    return {
        "id": model_id if index == 0 else f"vendor/model-{index}",
        "canonical_slug": model_id if index == 0 else f"vendor/model-{index}-20260723",
        "name": name if index == 0 else f"Vendor: Model {index}",
        "created": 1784000000 + index,
        "context_length": 1_000_000,
        "pricing": {"prompt": "0.000001", "completion": "0.000004"},
        "benchmarks": {"artificial_analysis": {"intelligence_index": 58.9}} if index == 0 else {},
    }


def aa_model(name="GPT-5.6 Sol (max)", intelligence=59):
    return {
        "model": name,
        "model_key": "gpt56sol",
        "model_exact_key": "gpt56solmax",
        "context_window": "1M",
        "creator": "OpenAI",
        "intelligence_index": intelligence,
        "cost_per_task_usd": 1.04,
        "speed_tokens_per_second": 63,
        "latency_first_chunk_seconds": 140.72,
        "total_response_seconds": 148.60,
    }


class LadderTests(unittest.TestCase):
    def test_parses_artificial_analysis_table_metrics(self):
        rows = "".join(
            f"<tr><td>Model {index}</td><td>1M</td><td>Creator</td><td>{60-index}</td><td>$1.04</td><td>63</td><td>2.5</td><td>9.5</td><td>Model Providers</td></tr>"
            for index in range(20)
        )
        parsed = parse_artificial_analysis_html(f"<table>{rows}</table>")
        self.assertEqual(len(parsed), 20)
        self.assertEqual(parsed[0]["intelligence_index"], 60)
        self.assertEqual(parsed[0]["cost_per_task_usd"], 1.04)
        self.assertEqual(parsed[0]["speed_tokens_per_second"], 63)
        self.assertEqual(parsed[0]["latency_first_chunk_seconds"], 2.5)
        self.assertEqual(parsed[0]["total_response_seconds"], 9.5)

    def test_parses_openrouter_catalog_and_prices(self):
        parsed = parse_openrouter_payload({"data": [openrouter_model(index) for index in range(20)]})
        self.assertEqual(len(parsed), 20)
        self.assertEqual(parsed[0]["model"], "GPT-5.6 Sol")
        self.assertEqual(parsed[0]["provider"], "OpenAI")
        self.assertEqual(parsed[0]["combined_price_per_million"], 5)
        self.assertEqual(parsed[0]["artificial_analysis_intelligence"], 58.9)

    def test_refresh_is_shared_and_limited_to_once_per_day(self):
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            def fetch_models():
                calls.append("called")
                return [{"id": "vendor/new-model", "canonical_slug": "vendor/new-model", "model": "New Model", "model_key": "newmodel", "provider": "Vendor", "created": 1}]

            service = LadderService(Path(directory), {OPENROUTER_SOURCE: fetch_models, ARTIFICIAL_ANALYSIS_SOURCE: lambda: []})
            first = service.refresh(OPENROUTER_SOURCE)
            second = service.refresh(OPENROUTER_SOURCE)
            self.assertTrue(first["refreshed"])
            self.assertFalse(second["refreshed"])
            self.assertEqual(second["reason"], "daily_limit")
            self.assertEqual(calls, ["called"])

    def test_concurrent_refresh_claim_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = LadderSnapshotStore(Path(directory) / "ladder.sqlite3")
            first = store.claim_refresh(OPENROUTER_SOURCE)
            second = store.claim_refresh(OPENROUTER_SOURCE)
            self.assertTrue(first["allowed"])
            self.assertFalse(second["allowed"])
            self.assertEqual(second["reason"], "refresh_in_progress")

    def test_community_evaluation_counter_has_transparent_baseline_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            service = LadderService(Path(directory), {OPENROUTER_SOURCE: lambda: [], ARTIFICIAL_ANALYSIS_SOURCE: lambda: []})
            initial = service.get_ladder()["community_evaluations"]
            event_id = str(uuid.uuid4())
            first = service.record_community_evaluation(event_id)
            duplicate = service.record_community_evaluation(event_id)
            second = service.record_community_evaluation(str(uuid.uuid4()))
            self.assertEqual(initial["baseline"], 284)
            self.assertEqual(initial["display_total"], 284)
            self.assertTrue(first["counted"])
            self.assertFalse(duplicate["counted"])
            self.assertEqual(duplicate["display_total"], 285)
            self.assertEqual(second["completed_runs"], 2)
            self.assertEqual(second["display_total"], 286)

    def test_ladder_uses_openrouter_catalog_and_maps_closest_aa_variant(self):
        with tempfile.TemporaryDirectory() as directory:
            service = LadderService(
                Path(directory),
                {
                    OPENROUTER_SOURCE: lambda: [{
                        "id": "openai/gpt-5.6-sol",
                        "canonical_slug": "openai/gpt-5.6-sol",
                        "model": "GPT-5.6 Sol",
                        "model_key": "gpt56sol",
                        "model_exact_key": "gpt56sol",
                        "provider": "OpenAI",
                        "created": 1784000000,
                        "context_length": 1_000_000,
                        "combined_price_per_million": 5,
                        "artificial_analysis_intelligence": 58.9,
                    }],
                    ARTIFICIAL_ANALYSIS_SOURCE: lambda: [aa_model("GPT-5.6 Sol (xhigh)", 58), aa_model("GPT-5.6 Sol (max)", 59)],
                },
            )
            service.refresh(OPENROUTER_SOURCE)
            service.refresh(ARTIFICIAL_ANALYSIS_SOURCE)
            ladder = service.get_ladder()
            self.assertEqual(len(ladder["models"]), 1)
            model = ladder["models"][0]
            self.assertEqual(model["aa_model"], "GPT-5.6 Sol (max)")
            self.assertEqual(model["quality"], 59)
            self.assertEqual(model["quality_source"], "artificial-analysis-snapshot")
            self.assertEqual(model["speed_tokens_per_second"], 63)

    def test_qualified_openrouter_variant_does_not_borrow_another_aa_effort(self):
        with tempfile.TemporaryDirectory() as directory:
            service = LadderService(
                Path(directory),
                {
                    OPENROUTER_SOURCE: lambda: [{
                        "id": "anthropic/claude-opus-4.8-fast",
                        "canonical_slug": "anthropic/claude-opus-4.8-fast",
                        "model": "Claude Opus 4.8 (Fast)",
                        "model_key": "claudeopus48",
                        "model_exact_key": "claudeopus48fast",
                        "provider": "Anthropic",
                        "created": 1,
                        "artificial_analysis_intelligence": None,
                    }],
                    ARTIFICIAL_ANALYSIS_SOURCE: lambda: [{
                        **aa_model("Claude Opus 4.8 (max)", 56),
                        "model_key": "claudeopus48",
                        "model_exact_key": "claudeopus48max",
                    }],
                },
            )
            service.refresh(OPENROUTER_SOURCE)
            service.refresh(ARTIFICIAL_ANALYSIS_SOURCE)
            model = service.get_ladder()["models"][0]
            self.assertIsNone(model["aa_model"])
            self.assertIsNone(model["quality"])

    def test_openrouter_aa_benchmark_is_labeled_without_snapshot_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            service = LadderService(
                Path(directory),
                {
                    OPENROUTER_SOURCE: lambda: [{
                        "id": "vendor/unmatched-model",
                        "canonical_slug": "vendor/unmatched-model",
                        "model": "Unmatched Model",
                        "model_key": "unmatchedmodel",
                        "model_exact_key": "unmatchedmodel",
                        "provider": "Vendor",
                        "created": 1,
                        "artificial_analysis_intelligence": 42.5,
                    }],
                    ARTIFICIAL_ANALYSIS_SOURCE: lambda: [],
                },
            )
            service.refresh(OPENROUTER_SOURCE)
            model = service.get_ladder()["models"][0]
            self.assertEqual(model["quality"], 42.5)
            self.assertEqual(model["quality_source"], "openrouter-aa-benchmark")
            self.assertIsNone(model["aa_model"])
            self.assertIsNone(model["speed_tokens_per_second"])

    def test_failed_refresh_keeps_previous_snapshot_and_applies_retry_window(self):
        with tempfile.TemporaryDirectory() as directory:
            service = LadderService(Path(directory), {OPENROUTER_SOURCE: lambda: [{"id": "one"}], ARTIFICIAL_ANALYSIS_SOURCE: lambda: []})
            self.assertTrue(service.refresh(OPENROUTER_SOURCE)["refreshed"])
            with service.store.connect() as connection:
                connection.execute(
                    "UPDATE ladder_snapshots SET refresh_available_at=? WHERE source=?",
                    ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), OPENROUTER_SOURCE),
                )

            def fail():
                raise RuntimeError("upstream unavailable")

            service.fetchers[OPENROUTER_SOURCE] = fail
            result = service.refresh(OPENROUTER_SOURCE)
            snapshot = service.store.get_snapshot(OPENROUTER_SOURCE)
            self.assertEqual(result["reason"], "upstream_failed")
            self.assertEqual(snapshot["payload"], [{"id": "one"}])
            self.assertIsNotNone(snapshot["last_error"])
            self.assertGreater(datetime.fromisoformat(snapshot["refresh_available_at"]), datetime.now(timezone.utc))


if __name__ == "__main__":
    unittest.main()
