"""Shared external model snapshots for the commercial ladder page."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.request import Request, urlopen

from .trusted_season import canonical_json, sha256_text, utc_now


OPENROUTER_SOURCE = "openrouter"
ARTIFICIAL_ANALYSIS_SOURCE = "artificial-analysis"
SUPPORTED_SOURCES = {OPENROUTER_SOURCE, ARTIFICIAL_ANALYSIS_SOURCE}
OPENROUTER_URL = "https://openrouter.ai/api/v1/models"
ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/leaderboards/models"
SUCCESS_REFRESH_INTERVAL = timedelta(hours=24)
FAILURE_RETRY_INTERVAL = timedelta(minutes=15)
REFRESH_LEASE = timedelta(minutes=5)
MAX_ARTIFICIAL_ANALYSIS_BYTES = 20 * 1024 * 1024
COMMUNITY_EVALUATION_BASELINE = 284
SOURCE_METADATA = {
    OPENROUTER_SOURCE: {"source_url": OPENROUTER_URL, "license_status": "public-api"},
    ARTIFICIAL_ANALYSIS_SOURCE: {"source_url": ARTIFICIAL_ANALYSIS_URL, "license_status": "public-page-reference"},
}


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(str(value).replace("$", "").replace(",", "").strip())
        return number if number >= 0 else None
    except (TypeError, ValueError):
        return None


def _model_key(value: str) -> str:
    value = value.split(":", 1)[-1].lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"\b(with fallback|adaptive reasoning|max effort|reasoning)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def _model_exact_key(value: str) -> str:
    value = value.split(":", 1)[-1].lower().replace("with fallback", "")
    return re.sub(r"[^a-z0-9]+", "", value)


class ArtificialAnalysisTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._row: Optional[list[str]] = None
        self._cell: Optional[list[str]] = None
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None
            self._cell = None


def parse_artificial_analysis_html(raw_html: str) -> list[dict[str, Any]]:
    parser = ArtificialAnalysisTableParser()
    parser.feed(raw_html)
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cells in parser.rows:
        if len(cells) != 9 or cells[0] == "Model":
            continue
        intelligence = _number(cells[3])
        cost_per_task = _number(cells[4])
        speed = _number(cells[5])
        latency = _number(cells[6])
        total_response = _number(cells[7])
        if not cells[0] or all(item is None for item in (intelligence, cost_per_task, speed, latency, total_response)):
            continue
        identity = canonical_json(cells[:8])
        if identity in seen:
            continue
        seen.add(identity)
        models.append({
            "model": cells[0],
            "model_key": _model_key(cells[0]),
            "model_exact_key": _model_exact_key(cells[0]),
            "context_window": cells[1] or None,
            "creator": cells[2] or None,
            "intelligence_index": intelligence,
            "cost_per_task_usd": cost_per_task,
            "speed_tokens_per_second": speed,
            "latency_first_chunk_seconds": latency,
            "total_response_seconds": total_response,
        })
    if len(models) < 20:
        raise ValueError("Artificial Analysis table did not contain enough model rows")
    return models


def parse_openrouter_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    for item in payload.get("data", []):
        model_id = str(item.get("id", "")).strip()
        full_name = str(item.get("name", "")).strip()
        if not model_id or not full_name:
            continue
        pricing = item.get("pricing") or {}
        prompt_price = _number(pricing.get("prompt"))
        completion_price = _number(pricing.get("completion"))
        combined_price = None
        if prompt_price is not None and completion_price is not None:
            combined_price = (prompt_price + completion_price) * 1_000_000
        provider, display_name = (full_name.split(":", 1) + [full_name])[:2] if ":" in full_name else (model_id.split("/", 1)[0], full_name)
        aa_benchmarks = (item.get("benchmarks") or {}).get("artificial_analysis") or {}
        models.append({
            "id": model_id,
            "canonical_slug": item.get("canonical_slug") or model_id,
            "model": display_name.strip(),
            "model_key": _model_key(display_name),
            "model_exact_key": _model_exact_key(display_name),
            "provider": provider.strip(),
            "created": int(item.get("created") or 0),
            "context_length": item.get("context_length"),
            "input_price_per_million": prompt_price * 1_000_000 if prompt_price is not None else None,
            "output_price_per_million": completion_price * 1_000_000 if completion_price is not None else None,
            "combined_price_per_million": combined_price,
            "artificial_analysis_intelligence": _number(aa_benchmarks.get("intelligence_index")),
        })
    if len(models) < 20:
        raise ValueError("OpenRouter payload did not contain enough models")
    return models


def fetch_openrouter_models() -> list[dict[str, Any]]:
    request = Request(OPENROUTER_URL, headers={"Accept": "application/json", "User-Agent": "ModLudus/0.4 ladder snapshot"})
    with urlopen(request, timeout=30) as response:
        return parse_openrouter_payload(json.loads(response.read()))


def fetch_artificial_analysis_models() -> list[dict[str, Any]]:
    request = Request(ARTIFICIAL_ANALYSIS_URL, headers={"Accept": "text/html", "User-Agent": "ModLudus/0.4 ladder snapshot"})
    with urlopen(request, timeout=45) as response:
        raw = response.read(MAX_ARTIFICIAL_ANALYSIS_BYTES + 1)
    if len(raw) > MAX_ARTIFICIAL_ANALYSIS_BYTES:
        raise ValueError("Artificial Analysis response exceeded the supported size")
    return parse_artificial_analysis_html(raw.decode("utf-8", errors="replace"))


class LadderSnapshotStore:
    def __init__(self, database_path: Path):
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self.database_path = database_path
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS ladder_snapshots (
                    source TEXT PRIMARY KEY,
                    captured_at TEXT,
                    refresh_available_at TEXT,
                    state TEXT NOT NULL DEFAULT 'idle',
                    attempt INTEGER NOT NULL DEFAULT 0,
                    lease_until TEXT,
                    payload_json TEXT,
                    content_hash TEXT,
                    item_count INTEGER NOT NULL DEFAULT 0,
                    source_url TEXT,
                    license_status TEXT,
                    last_error TEXT,
                    updated_at TEXT NOT NULL
                )
                """
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(ladder_snapshots)").fetchall()}
            if "source_url" not in columns:
                connection.execute("ALTER TABLE ladder_snapshots ADD COLUMN source_url TEXT")
            if "license_status" not in columns:
                connection.execute("ALTER TABLE ladder_snapshots ADD COLUMN license_status TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS community_evaluation_events (
                    event_id TEXT PRIMARY KEY,
                    recorded_at TEXT NOT NULL
                )
                """
            )

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def get_snapshot(self, source: str) -> Optional[dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM ladder_snapshots WHERE source=?", (source,)).fetchone()
        if not row:
            return None
        value = dict(row)
        value["payload"] = json.loads(value.pop("payload_json")) if value.get("payload_json") else []
        return value

    def claim_refresh(self, source: str) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        now_text = now.isoformat()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM ladder_snapshots WHERE source=?", (source,)).fetchone()
            if row:
                available_at = _parse_datetime(row["refresh_available_at"])
                lease_until = _parse_datetime(row["lease_until"])
                if row["state"] == "refreshing" and lease_until and lease_until > now:
                    return {"allowed": False, "reason": "refresh_in_progress", "retry_at": row["lease_until"]}
                if available_at and available_at > now:
                    return {"allowed": False, "reason": "daily_limit", "retry_at": row["refresh_available_at"]}
                attempt = int(row["attempt"]) + 1
                connection.execute(
                    "UPDATE ladder_snapshots SET state='refreshing',attempt=?,lease_until=?,last_error=NULL,updated_at=? WHERE source=?",
                    (attempt, (now + REFRESH_LEASE).isoformat(), now_text, source),
                )
            else:
                attempt = 1
                connection.execute(
                    "INSERT INTO ladder_snapshots(source,state,attempt,lease_until,updated_at) VALUES(?,?,?,?,?)",
                    (source, "refreshing", attempt, (now + REFRESH_LEASE).isoformat(), now_text),
                )
        return {"allowed": True, "attempt": attempt}

    def complete_refresh(self, source: str, attempt: int, payload: list[dict[str, Any]]) -> bool:
        captured_at = utc_now()
        payload_json = canonical_json(payload)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE ladder_snapshots
                SET captured_at=?,refresh_available_at=?,state='idle',lease_until=NULL,
                    payload_json=?,content_hash=?,item_count=?,source_url=?,license_status=?,last_error=NULL,updated_at=?
                WHERE source=? AND attempt=? AND state='refreshing'
                """,
                (
                    captured_at,
                    (datetime.fromisoformat(captured_at) + SUCCESS_REFRESH_INTERVAL).isoformat(),
                    payload_json,
                    sha256_text(payload_json),
                    len(payload),
                    SOURCE_METADATA[source]["source_url"],
                    SOURCE_METADATA[source]["license_status"],
                    captured_at,
                    source,
                    attempt,
                ),
            )
        return cursor.rowcount == 1

    def fail_refresh(self, source: str, attempt: int, error: Exception) -> bool:
        now = datetime.now(timezone.utc)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE ladder_snapshots
                SET state='idle',lease_until=NULL,refresh_available_at=?,last_error=?,updated_at=?
                WHERE source=? AND attempt=? AND state='refreshing'
                """,
                ((now + FAILURE_RETRY_INTERVAL).isoformat(), f"{type(error).__name__}: {error}"[:500], now.isoformat(), source, attempt),
            )
        return cursor.rowcount == 1

    def community_evaluations(self) -> dict[str, Any]:
        with self.connect() as connection:
            completed_runs = int(connection.execute("SELECT COUNT(*) FROM community_evaluation_events").fetchone()[0])
        return {
            "baseline": COMMUNITY_EVALUATION_BASELINE,
            "completed_runs": completed_runs,
            "display_total": COMMUNITY_EVALUATION_BASELINE + completed_runs,
            "disclosure": "includes_internal_baseline",
        }

    def record_community_evaluation(self, event_id: str) -> dict[str, Any]:
        try:
            normalized_event_id = str(uuid.UUID(event_id))
        except (ValueError, AttributeError, TypeError) as error:
            raise ValueError("invalid community evaluation event id") from error
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "INSERT OR IGNORE INTO community_evaluation_events(event_id,recorded_at) VALUES(?,?)",
                (normalized_event_id, utc_now()),
            )
            completed_runs = int(connection.execute("SELECT COUNT(*) FROM community_evaluation_events").fetchone()[0])
        return {
            "baseline": COMMUNITY_EVALUATION_BASELINE,
            "completed_runs": completed_runs,
            "display_total": COMMUNITY_EVALUATION_BASELINE + completed_runs,
            "disclosure": "includes_internal_baseline",
            "counted": cursor.rowcount == 1,
        }


class LadderService:
    def __init__(
        self,
        data_dir: Path,
        fetchers: Optional[dict[str, Callable[[], list[dict[str, Any]]]]] = None,
    ) -> None:
        self.store = LadderSnapshotStore(data_dir / "ladder-cache.sqlite3")
        self.fetchers = fetchers or {
            OPENROUTER_SOURCE: fetch_openrouter_models,
            ARTIFICIAL_ANALYSIS_SOURCE: fetch_artificial_analysis_models,
        }

    @classmethod
    def from_environment(cls) -> "LadderService":
        data_dir = Path(os.environ.get("MODLUDUS_LADDER_CACHE_DIR") or os.environ.get("MODLUDUS_EVIDENCE_DIR", "/tmp/modludus-evidence"))
        return cls(data_dir)

    def refresh(self, source: str) -> dict[str, Any]:
        if source not in SUPPORTED_SOURCES:
            raise ValueError("unsupported ladder source")
        claim = self.store.claim_refresh(source)
        if not claim["allowed"]:
            return {"source": source, "refreshed": False, **claim}
        attempt = int(claim["attempt"])
        try:
            payload = self.fetchers[source]()
            if not self.store.complete_refresh(source, attempt, payload):
                return {"source": source, "refreshed": False, "reason": "refresh_superseded"}
            snapshot = self.store.get_snapshot(source) or {}
            return {
                "source": source,
                "refreshed": True,
                "captured_at": snapshot.get("captured_at"),
                "retry_at": snapshot.get("refresh_available_at"),
                "item_count": snapshot.get("item_count", 0),
            }
        except Exception as error:
            self.store.fail_refresh(source, attempt, error)
            snapshot = self.store.get_snapshot(source) or {}
            return {
                "source": source,
                "refreshed": False,
                "reason": "upstream_failed",
                "retry_at": snapshot.get("refresh_available_at"),
                "error_type": type(error).__name__,
            }

    def record_community_evaluation(self, event_id: str) -> dict[str, Any]:
        return self.store.record_community_evaluation(event_id)

    def _source_status(self, source: str) -> dict[str, Any]:
        snapshot = self.store.get_snapshot(source)
        if not snapshot:
            return {"source": source, "captured_at": None, "retry_at": None, "item_count": 0, "state": "idle", "last_error": None, **SOURCE_METADATA[source]}
        return {
            "source": source,
            "captured_at": snapshot.get("captured_at"),
            "retry_at": snapshot.get("refresh_available_at"),
            "item_count": snapshot.get("item_count", 0),
            "state": snapshot.get("state", "idle"),
            "last_error": snapshot.get("last_error"),
            "source_url": snapshot.get("source_url") or SOURCE_METADATA[source]["source_url"],
            "license_status": snapshot.get("license_status") or SOURCE_METADATA[source]["license_status"],
        }

    def get_ladder(self) -> dict[str, Any]:
        openrouter_snapshot = self.store.get_snapshot(OPENROUTER_SOURCE)
        artificial_snapshot = self.store.get_snapshot(ARTIFICIAL_ANALYSIS_SOURCE)
        openrouter_models = (openrouter_snapshot or {}).get("payload", [])
        artificial_models = (artificial_snapshot or {}).get("payload", [])

        aa_by_key: dict[str, list[dict[str, Any]]] = {}
        aa_by_exact_key: dict[str, list[dict[str, Any]]] = {}
        for item in artificial_models:
            aa_by_key.setdefault(item.get("model_key") or _model_key(item.get("model", "")), []).append(item)
            aa_by_exact_key.setdefault(item.get("model_exact_key") or _model_exact_key(item.get("model", "")), []).append(item)
        for matches in aa_by_key.values():
            matches.sort(key=lambda item: item.get("intelligence_index") if item.get("intelligence_index") is not None else -1, reverse=True)
        for matches in aa_by_exact_key.values():
            matches.sort(key=lambda item: item.get("intelligence_index") if item.get("intelligence_index") is not None else -1, reverse=True)

        deduplicated: dict[str, dict[str, Any]] = {}
        for item in openrouter_models:
            slug = item.get("canonical_slug") or item["id"]
            existing = deduplicated.get(slug)
            if existing and not existing["id"].endswith(":free"):
                continue
            if existing and item["id"].endswith(":free"):
                continue
            deduplicated[slug] = item

        merged = []
        for item in deduplicated.values():
            benchmark = item.get("artificial_analysis_intelligence")
            exact_candidates = aa_by_exact_key.get(item.get("model_exact_key") or _model_exact_key(item.get("model", "")), [])
            if exact_candidates:
                aa_candidates = exact_candidates
            elif "(" in item.get("model", "") and benchmark is None:
                aa_candidates = []
            else:
                aa_candidates = aa_by_key.get(item.get("model_key", ""), [])
            if benchmark is not None and aa_candidates:
                aa_match = min(
                    aa_candidates,
                    key=lambda candidate: abs((candidate.get("intelligence_index") if candidate.get("intelligence_index") is not None else -999) - benchmark),
                )
            else:
                aa_match = aa_candidates[0] if aa_candidates else None
            merged.append({
                **item,
                "quality": (aa_match or {}).get("intelligence_index", benchmark),
                "quality_source": "artificial-analysis-snapshot" if aa_match else "openrouter-aa-benchmark" if benchmark is not None else None,
                "aa_model": (aa_match or {}).get("model"),
                "aa_cost_per_task_usd": (aa_match or {}).get("cost_per_task_usd"),
                "speed_tokens_per_second": (aa_match or {}).get("speed_tokens_per_second"),
                "latency_first_chunk_seconds": (aa_match or {}).get("latency_first_chunk_seconds"),
                "total_response_seconds": (aa_match or {}).get("total_response_seconds"),
                "aa_context_window": (aa_match or {}).get("context_window"),
                "measured_samples": 0,
                "evidence_version": "待首轮标准评测",
            })
        merged.sort(key=lambda item: item.get("created", 0), reverse=True)
        return {
            "models": merged,
            "community_evaluations": self.store.community_evaluations(),
            "sources": {
                OPENROUTER_SOURCE: self._source_status(OPENROUTER_SOURCE),
                ARTIFICIAL_ANALYSIS_SOURCE: self._source_status(ARTIFICIAL_ANALYSIS_SOURCE),
            },
            "generated_at": utc_now(),
        }
