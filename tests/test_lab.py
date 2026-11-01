import json
import os
from pathlib import Path
import tempfile
import unittest

from tools.codex_lab.inventory import classify_source, inventory
from tools.codex_lab.safety import Lab, SafetyError


class LabSafetyTests(unittest.TestCase):
    def test_live_and_unowned_paths_are_rejected(self):
        for path in [Path.home() / '.codex', Path(tempfile.gettempdir()), Path.cwd()]:
            with self.assertRaises(SafetyError):
                Lab(path)
        lab = Lab.create()
        with self.assertRaises(SafetyError):
            lab.checked(Path.home() / '.codex' / 'state_5.sqlite')
        with self.assertRaises(SafetyError):
            lab.checked(lab.root / '..' / 'escape')

    def test_symlinks_are_rejected(self):
        lab = Lab.create()
        (lab.root / 'escape').symlink_to(Path.home() / '.codex')
        with self.assertRaises(SafetyError):
            lab.checked(lab.root / 'escape' / 'state_5.sqlite')
        inside = lab.directory('real')
        (lab.root / 'alias').symlink_to(inside)
        with self.assertRaises(SafetyError):
            lab.checked(lab.root / 'alias' / 'data')

    def test_environment_does_not_inherit_credentials(self):
        lab = Lab.create()
        env = lab.environment(lab.directory('home'))
        self.assertNotIn('HOME', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('HTTP_PROXY', env)
        self.assertNotEqual(env['CODEX_HOME'], str(Path.home() / '.codex'))

    def test_desktop_vscode_marker_is_not_misclassified(self):
        self.assertEqual(classify_source({'source': 'vscode', 'originator': 'codex_work_desktop'}), 'desktop')
        self.assertEqual(classify_source({'source': 'vscode', 'originator': 'custom_client'}), 'unknown')
        self.assertEqual(classify_source({'source': {'subagent': {'other': 'guardian'}}, 'originator': 'codex_work_desktop'}), 'subagent')
        self.assertEqual(classify_source({'source': 'cli'}), 'cli')

    def test_inventory_never_outputs_history_and_reports_corruption(self):
        lab = Lab.create()
        folder = lab.directory('home/sessions')
        header = {'type': 'session_meta', 'payload': {'source': 'cli', 'id': 'private-id', 'cwd': '/private/project'}}
        original = json.dumps(header) + '\n' + 'PRIVATE CONVERSATION BODY\n'
        (folder / 'valid.jsonl').write_text(original)
        (folder / 'broken.jsonl').write_text('not json\n')
        (folder / 'linked.jsonl').symlink_to(folder / 'valid.jsonl')
        report = inventory(folder.parent)
        text = json.dumps(report)
        self.assertNotIn('PRIVATE', text)
        self.assertNotIn('private-id', text)
        self.assertEqual(report['rolloutCount'], 3)
        self.assertEqual(report['sources'], {'cli': 1})
        self.assertEqual(report['errors'], {'unreadable_or_changed': 2})
        self.assertEqual((folder / 'valid.jsonl').read_text(), original)
