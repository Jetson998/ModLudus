"""Offline backup, verification and restore for trusted-season evidence."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .trusted_season import EvidenceSigner, canonical_json, sha256_text, utc_now


BACKUP_FORMAT = "modludus-trusted-backup-v1"
DATABASE_NAME = "trusted-season.sqlite3"
PRIVATE_KEY_NAME = "ed25519-private.key"
MANIFEST_NAME = "backup-manifest.json"
REQUIRED_TABLES = {
    "trusted_runs",
    "immutable_evidence",
    "audit_events",
    "trusted_jobs",
    "worker_heartbeats",
    "review_decisions",
    "season_publications",
}
MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _public_key_from_private(private_key: bytes) -> str:
    if len(private_key) != 32:
        raise ValueError("invalid Ed25519 private key length")
    key = Ed25519PrivateKey.from_private_bytes(private_key)
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def _readonly_connection(database_path: Path) -> sqlite3.Connection:
    # The online snapshot retains WAL journal metadata but has no sidecar files.
    # immutable=1 prevents SQLite from trying to create -wal/-shm files during verification.
    connection = sqlite3.connect(f"file:{database_path.resolve()}?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def validate_evidence_database(database_path: Path, expected_public_key: str | None = None) -> dict[str, Any]:
    """Validate a snapshot without initializing or mutating its schema."""
    with _readonly_connection(database_path) as connection:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite integrity check failed: {integrity}")

        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        missing_tables = sorted(REQUIRED_TABLES - tables)
        if missing_tables:
            raise ValueError(f"backup database is missing tables: {', '.join(missing_tables)}")

        previous_hash = "GENESIS"
        audit_rows = connection.execute("SELECT * FROM audit_events ORDER BY seq").fetchall()
        for row in audit_rows:
            if row["previous_hash"] != previous_hash:
                raise ValueError(f"audit chain previous hash mismatch at seq {row['seq']}")
            try:
                payload = json.loads(row["payload_json"])
            except json.JSONDecodeError as error:
                raise ValueError(f"audit payload is invalid JSON at seq {row['seq']}") from error
            expected_hash = sha256_text(canonical_json({
                "run_id": row["run_id"],
                "event_type": row["event_type"],
                "payload": payload,
                "previous_hash": row["previous_hash"],
                "created_at": row["created_at"],
            }))
            if row["event_hash"] != expected_hash:
                raise ValueError(f"audit event hash mismatch at seq {row['seq']}")
            previous_hash = row["event_hash"]

        evidence_rows = connection.execute("SELECT * FROM immutable_evidence ORDER BY created_at").fetchall()
        for row in evidence_rows:
            try:
                report = json.loads(row["report_json"])
            except json.JSONDecodeError as error:
                raise ValueError(f"evidence report is invalid JSON for run {row['run_id']}") from error
            report_hash = sha256_text(canonical_json(report))
            if report_hash != row["evidence_hash"]:
                raise ValueError(f"evidence hash mismatch for run {row['run_id']}")
            if not EvidenceSigner.verify(row["evidence_hash"], row["signature"], row["public_key"]):
                raise ValueError(f"evidence signature is invalid for run {row['run_id']}")
            if expected_public_key and row["public_key"] != expected_public_key:
                raise ValueError(f"evidence signing key mismatch for run {row['run_id']}")

        counts = {
            table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in sorted(REQUIRED_TABLES)
        }
    return {
        "integrity_check": "ok",
        "audit_chain_valid": True,
        "evidence_signatures_valid": True,
        "counts": counts,
    }


def _snapshot_database(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"evidence database not found: {source}")
    with sqlite3.connect(source) as source_connection, sqlite3.connect(destination) as destination_connection:
        source_connection.backup(destination_connection)
        destination_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def _zip_info(name: str, mode: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (mode & 0xFFFF) << 16
    return info


def create_backup(data_dir: Path, output_path: Path) -> dict[str, Any]:
    data_dir = data_dir.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise FileExistsError(f"backup output already exists: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    private_key_path = data_dir / PRIVATE_KEY_NAME
    if not private_key_path.is_file():
        raise FileNotFoundError(f"signing key not found: {private_key_path}")
    private_key = private_key_path.read_bytes()
    public_key = _public_key_from_private(private_key)

    with tempfile.TemporaryDirectory(prefix="modludus-backup-", dir=output_path.parent) as temporary_directory:
        temporary = Path(temporary_directory)
        snapshot_path = temporary / DATABASE_NAME
        _snapshot_database(data_dir / DATABASE_NAME, snapshot_path)
        database_validation = validate_evidence_database(snapshot_path, public_key)
        database_bytes = snapshot_path.read_bytes()
        manifest = {
            "format": BACKUP_FORMAT,
            "created_at": utc_now(),
            "sensitive": True,
            "signing_key_fingerprint": sha256_text(public_key)[:16],
            "database_validation": database_validation,
            "files": {
                DATABASE_NAME: {"sha256": _sha256_bytes(database_bytes), "size": len(database_bytes)},
                PRIVATE_KEY_NAME: {"sha256": _sha256_bytes(private_key), "size": len(private_key)},
            },
        }
        manifest_bytes = canonical_json(manifest).encode("utf-8")
        temporary_archive = temporary / "backup.zip"
        with zipfile.ZipFile(temporary_archive, "w") as archive:
            archive.writestr(_zip_info(MANIFEST_NAME, 0o600), manifest_bytes)
            archive.writestr(_zip_info(DATABASE_NAME, 0o600), database_bytes)
            archive.writestr(_zip_info(PRIVATE_KEY_NAME, 0o600), private_key)
        temporary_archive.chmod(0o600)
        os.replace(temporary_archive, output_path)
        output_path.chmod(0o600)
    return {"backup": str(output_path), "archive_sha256": _sha256_bytes(output_path.read_bytes()), **manifest}


def _read_backup(backup_path: Path) -> tuple[dict[str, Any], bytes, bytes, str]:
    if not backup_path.is_file():
        raise FileNotFoundError(f"backup not found: {backup_path}")
    archive_bytes = backup_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        names = archive.namelist()
        expected_names = {MANIFEST_NAME, DATABASE_NAME, PRIVATE_KEY_NAME}
        if len(names) != len(set(names)) or set(names) != expected_names:
            raise ValueError("backup archive must contain exactly the expected files")
        if sum(item.file_size for item in archive.infolist()) > MAX_BACKUP_BYTES:
            raise ValueError("backup archive exceeds the supported size limit")
        manifest_bytes = archive.read(MANIFEST_NAME)
        database_bytes = archive.read(DATABASE_NAME)
        private_key = archive.read(PRIVATE_KEY_NAME)
    try:
        manifest = json.loads(manifest_bytes)
    except json.JSONDecodeError as error:
        raise ValueError("backup manifest is invalid JSON") from error
    if manifest.get("format") != BACKUP_FORMAT:
        raise ValueError("unsupported backup format")
    for name, value in ((DATABASE_NAME, database_bytes), (PRIVATE_KEY_NAME, private_key)):
        expected = manifest.get("files", {}).get(name, {})
        if expected.get("size") != len(value) or expected.get("sha256") != _sha256_bytes(value):
            raise ValueError(f"backup file hash mismatch: {name}")
    return manifest, database_bytes, private_key, _sha256_bytes(archive_bytes)


def _verify_backup_payload(
    backup_path: Path,
    manifest: dict[str, Any],
    database_bytes: bytes,
    private_key: bytes,
    archive_sha256: str,
) -> dict[str, Any]:
    public_key = _public_key_from_private(private_key)
    if manifest.get("signing_key_fingerprint") != sha256_text(public_key)[:16]:
        raise ValueError("backup signing key fingerprint mismatch")
    with tempfile.TemporaryDirectory(prefix="modludus-backup-verify-") as temporary_directory:
        database_path = Path(temporary_directory) / DATABASE_NAME
        database_path.write_bytes(database_bytes)
        validation = validate_evidence_database(database_path, public_key)
    if validation != manifest.get("database_validation"):
        raise ValueError("backup database validation snapshot mismatch")
    return {
        "verified": True,
        "backup": str(backup_path.resolve()),
        "archive_sha256": archive_sha256,
        "format": BACKUP_FORMAT,
        "created_at": manifest["created_at"],
        "signing_key_fingerprint": manifest["signing_key_fingerprint"],
        "database_validation": validation,
    }


def verify_backup(backup_path: Path) -> dict[str, Any]:
    resolved_path = backup_path.resolve()
    manifest, database_bytes, private_key, archive_sha256 = _read_backup(resolved_path)
    return _verify_backup_payload(resolved_path, manifest, database_bytes, private_key, archive_sha256)


def restore_backup(backup_path: Path, target_dir: Path) -> dict[str, Any]:
    resolved_path = backup_path.resolve()
    manifest, database_bytes, private_key, archive_sha256 = _read_backup(resolved_path)
    verification = _verify_backup_payload(resolved_path, manifest, database_bytes, private_key, archive_sha256)
    target_dir = target_dir.resolve()
    if target_dir.exists() and any(target_dir.iterdir()):
        raise FileExistsError(f"restore target must be empty: {target_dir}")
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="modludus-restore-", dir=target_dir.parent) as temporary_directory:
        staging = Path(temporary_directory) / "evidence"
        staging.mkdir()
        database_path = staging / DATABASE_NAME
        private_key_path = staging / PRIVATE_KEY_NAME
        database_path.write_bytes(database_bytes)
        private_key_path.write_bytes(private_key)
        database_path.chmod(0o600)
        private_key_path.chmod(0o600)
        validate_evidence_database(database_path, _public_key_from_private(private_key))
        if target_dir.exists():
            target_dir.rmdir()
        os.replace(staging, target_dir)
    return {"restored": True, "target_dir": str(target_dir), **verification}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ModLudus trusted evidence backup tool")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="create a live SQLite snapshot and signing-key backup")
    create.add_argument("--data-dir", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    verify = commands.add_parser("verify", help="verify archive hashes, SQLite, audit chain and signatures")
    verify.add_argument("--input", type=Path, required=True)
    restore = commands.add_parser("restore", help="restore only into a missing or empty directory")
    restore.add_argument("--input", type=Path, required=True)
    restore.add_argument("--target-dir", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "create":
        result = create_backup(args.data_dir, args.output)
    elif args.command == "verify":
        result = verify_backup(args.input)
    else:
        result = restore_backup(args.input, args.target_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
