import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import app.backup as backup_module
from app.backup import (
    DATABASE_NAME,
    MANIFEST_NAME,
    PRIVATE_KEY_NAME,
    create_backup,
    restore_backup,
    verify_backup,
)
from app.trusted_season import EvidenceSigner, EvidenceStore


class TrustedBackupTests(unittest.TestCase):
    def _evidence_directory(self, root: Path) -> tuple[Path, EvidenceStore, EvidenceSigner]:
        data_dir = root / "evidence"
        store = EvidenceStore(data_dir / DATABASE_NAME)
        signer = EvidenceSigner(data_dir / PRIVATE_KEY_NAME)
        store.create_run("run-backup", "manifest-hash", "local-e2e", True)
        store.save_evidence(
            "run-backup",
            {
                "schema_version": "m3.3",
                "run_id": "run-backup",
                "manifest": {"environment": "local-e2e", "simulated": True},
                "results": [],
                "ranking": [],
            },
            signer,
        )
        store.update_run("run-backup", status="completed")
        return data_dir, store, signer

    def test_create_verify_and_restore_preserves_evidence_and_signing_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir, store, signer = self._evidence_directory(root)
            backup_path = root / "trusted-backup.zip"

            created = create_backup(data_dir, backup_path)
            verified = verify_backup(backup_path)
            restored_dir = root / "restored"
            with patch("app.backup._read_backup", wraps=backup_module._read_backup) as archive_reader:
                restored = restore_backup(backup_path, restored_dir)
            archive_reader.assert_called_once()

            self.assertEqual(backup_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(created["signing_key_fingerprint"], signer.public_key_fingerprint)
            self.assertTrue(verified["verified"])
            self.assertTrue(verified["database_validation"]["audit_chain_valid"])
            self.assertEqual(verified["database_validation"]["counts"]["immutable_evidence"], 1)
            self.assertTrue(restored["restored"])
            self.assertEqual((restored_dir / PRIVATE_KEY_NAME).stat().st_mode & 0o777, 0o600)
            restored_store = EvidenceStore(restored_dir / DATABASE_NAME)
            restored_signer = EvidenceSigner(restored_dir / PRIVATE_KEY_NAME)
            self.assertEqual(restored_signer.public_key_fingerprint, signer.public_key_fingerprint)
            self.assertEqual(restored_store.get_evidence("run-backup")["evidence_hash"], store.get_evidence("run-backup")["evidence_hash"])
            self.assertTrue(restored_store.verify_audit_chain())

    def test_backup_refuses_overwrite_and_restore_refuses_nonempty_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir, _store, _signer = self._evidence_directory(root)
            backup_path = root / "trusted-backup.zip"
            create_backup(data_dir, backup_path)
            with self.assertRaises(FileExistsError):
                create_backup(data_dir, backup_path)

            target = root / "existing"
            target.mkdir()
            (target / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                restore_backup(backup_path, target)
            self.assertEqual((target / "keep.txt").read_text(encoding="utf-8"), "keep")

    def test_verify_rejects_tampered_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir, _store, _signer = self._evidence_directory(root)
            backup_path = root / "trusted-backup.zip"
            create_backup(data_dir, backup_path)
            tampered_path = root / "tampered.zip"
            with zipfile.ZipFile(backup_path) as source, zipfile.ZipFile(tampered_path, "w") as target:
                for name in source.namelist():
                    value = source.read(name)
                    if name == DATABASE_NAME:
                        value += b"tampered"
                    target.writestr(name, value)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                verify_backup(tampered_path)

    def test_verify_rejects_unexpected_archive_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir, _store, _signer = self._evidence_directory(root)
            backup_path = root / "trusted-backup.zip"
            create_backup(data_dir, backup_path)
            unsafe_path = root / "unsafe.zip"
            with zipfile.ZipFile(backup_path) as source, zipfile.ZipFile(unsafe_path, "w") as target:
                for name in source.namelist():
                    target.writestr(name, source.read(name))
                target.writestr("../outside", b"unsafe")
            with self.assertRaisesRegex(ValueError, "exactly the expected files"):
                verify_backup(unsafe_path)

    def test_verify_rejects_manifest_fingerprint_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir, _store, _signer = self._evidence_directory(root)
            backup_path = root / "trusted-backup.zip"
            create_backup(data_dir, backup_path)
            tampered_path = root / "manifest-tampered.zip"
            with zipfile.ZipFile(backup_path) as source, zipfile.ZipFile(tampered_path, "w") as target:
                for name in source.namelist():
                    value = source.read(name)
                    if name == MANIFEST_NAME:
                        manifest = json.loads(value)
                        manifest["signing_key_fingerprint"] = "0000000000000000"
                        value = json.dumps(manifest).encode("utf-8")
                    target.writestr(name, value)
            with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
                verify_backup(tampered_path)


if __name__ == "__main__":
    unittest.main()
