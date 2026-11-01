import json
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

from tools.codex_lab.bundle import (digest, export_bundle, import_bundle, restore_backup,
                                   exclusive_home, verify_bundle)
from tools.codex_lab.safety import Lab, SafetyError


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.lab = Lab.create()
        self.a = self.lab.directory('a')
        self.b = self.lab.directory('b')
        self.tid = str(uuid.uuid4())
        self.path = self.lab.directory('a/sessions/2026/11/01') / ('rollout-test-' + self.tid + '.jsonl')
        self.meta = {'type': 'session_meta', 'payload': {'id': self.tid,
            'timestamp': '2026-11-01T12:00:00Z', 'originator': 'sesshuttle_lab',
            'cli_version': '0.166.0-alpha.5.1', 'cwd': str(self.a)}}
        self.raw = (json.dumps(self.meta) + '\n' + json.dumps({'type': 'response_item',
            'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': '中文 early marker'}]}}) + '\n').encode()
        self.path.write_bytes(self.raw)
        self.package = self.lab.root / 'package'
        export_bundle(self.lab, self.a, self.path, self.package)

    def test_lossless_import_and_repeat(self):
        result = import_bundle(self.lab, self.b, self.package)
        self.assertEqual(result['status'], 'imported-needs-validation')
        self.assertEqual(Path(result['path']).read_bytes(), self.raw)
        self.assertIsNotNone(result['backup'])
        self.assertEqual(import_bundle(self.lab, self.b, self.package)['status'], 'unchanged')
        self.assertEqual(len(list(self.b.rglob('*.jsonl'))), 1)

    def test_corruption_changes_nothing(self):
        (self.b / 'sentinel').write_text('keep')
        (self.package / 'rollout.jsonl').write_bytes(self.raw + b'corruption')
        with self.assertRaises(ValueError):
            import_bundle(self.lab, self.b, self.package)
        self.assertEqual([p.name for p in self.b.iterdir()], ['sentinel'])

    def test_conflict_preserves_both_versions(self):
        result = import_bundle(self.lab, self.b, self.package)
        target = Path(result['path'])
        branch = self.raw + b'{"type":"event_msg","payload":{"text":"B branch"}}\n'
        target.write_bytes(branch)
        self.path.write_bytes(self.raw + b'{"type":"event_msg","payload":{"text":"A branch"}}\n')
        package2 = self.lab.root / 'package2'
        export_bundle(self.lab, self.a, self.path, package2)
        self.assertEqual(import_bundle(self.lab, self.b, package2)['status'], 'conflict')
        self.assertEqual(target.read_bytes(), branch)
        self.assertTrue((package2 / 'rollout.jsonl').is_file())

    def test_backup_failure_stops_import(self):
        (self.b / 'sentinel').write_text('keep')
        with patch('tools.codex_lab.bundle._backup', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                import_bundle(self.lab, self.b, self.package)
        self.assertFalse((self.b / 'sessions').exists())
        self.assertEqual((self.b / 'sentinel').read_text(), 'keep')

    def test_restore_preserves_displaced_state(self):
        (self.b / 'sentinel').write_text('before')
        result = import_bundle(self.lab, self.b, self.package)
        restored = restore_backup(self.lab, Path(result['backup']))
        self.assertEqual((self.b / 'sentinel').read_text(), 'before')
        self.assertFalse((self.b / 'sessions').exists())
        self.assertTrue(list(Path(restored['preserved']).rglob('*.jsonl')))

    def test_unknown_version_and_external_attachment_are_rejected(self):
        meta = json.loads(json.dumps(self.meta))
        meta['payload']['cli_version'] = '99.99.99'
        self.path.write_text(json.dumps(meta) + '\n')
        with self.assertRaises(ValueError):
            export_bundle(self.lab, self.a, self.path, self.lab.root / 'unknown')
        self.path.write_bytes(self.raw + b'{"type":"response_item","payload":{"type":"input_image","image_url":"https://example.com/private.png"}}\n')
        with self.assertRaises(ValueError):
            export_bundle(self.lab, self.a, self.path, self.lab.root / 'external')

    def test_busy_home_and_symlink_escape_are_rejected(self):
        with exclusive_home(self.lab, self.b):
            with self.assertRaises(SafetyError):
                import_bundle(self.lab, self.b, self.package)
        (self.b / 'sessions').symlink_to(self.a / 'sessions')
        with self.assertRaises(SafetyError):
            import_bundle(self.lab, self.b, self.package)
        self.assertEqual(self.path.read_bytes(), self.raw)

    def test_invalid_backup_path_does_not_write(self):
        result = import_bundle(self.lab, self.b, self.package)
        backup = Path(result['backup'])
        info = json.loads((backup / 'backup.json').read_text())
        info['files']['../escape'] = '0' * 64
        (backup / 'backup.json').write_text(json.dumps(info))
        with self.assertRaises((SafetyError, ValueError)):
            restore_backup(self.lab, backup)
        self.assertTrue(Path(result['path']).exists())

    def test_archive_location_is_preserved(self):
        archived = self.lab.directory('a/archived_sessions') / self.path.name
        self.path.rename(archived)
        package = self.lab.root / 'archived-package'
        export_bundle(self.lab, self.a, archived, package)
        result = import_bundle(self.lab, self.b, package)
        self.assertEqual(Path(result['path']).parent, self.b / 'archived_sessions')

    def test_interrupted_publish_is_recoverable(self):
        (self.b / 'sentinel').write_text('before')
        with patch('tools.codex_lab.bundle.os.replace', side_effect=OSError('simulated interruption')):
            with self.assertRaises(OSError):
                import_bundle(self.lab, self.b, self.package)
        self.assertFalse(list(self.b.rglob('*.jsonl')))
        backups = list((self.lab.root / 'backups').iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads((backups[0] / 'import.json').read_text())['state'], 'prepared')
        restore_backup(self.lab, backups[0])
        self.assertEqual((self.b / 'sentinel').read_text(), 'before')
        self.assertEqual(import_bundle(self.lab, self.b, self.package)['status'], 'imported-needs-validation')

    def test_corrupted_backup_refuses_restore(self):
        (self.b / 'sentinel').write_text('before')
        result = import_bundle(self.lab, self.b, self.package)
        backup = Path(result['backup'])
        (backup / 'home/sentinel').write_text('damaged')
        with self.assertRaises(ValueError):
            restore_backup(self.lab, backup)
        self.assertTrue(Path(result['path']).exists())
        self.assertEqual((self.b / 'sentinel').read_text(), 'before')

    def test_lock_symlink_cannot_escape(self):
        other = self.lab.root / 'keep'
        other.write_text('unchanged')
        locks = self.lab.directory('locks')
        path = locks / (digest(str(self.b).encode()) + '.lock')
        path.symlink_to(other)
        with self.assertRaises(SafetyError):
            import_bundle(self.lab, self.b, self.package)
        self.assertEqual(other.read_text(), 'unchanged')
