import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup_releases', Path(__file__).parents[1] / 'scripts/cleanup-releases.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CleanupReleasesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.release = self.root / 'releases' / '20261019-current'
        self.release.mkdir(parents=True)
        (self.release / 'main.js').write_text('current')
        (self.root / 'data').mkdir()
        (self.root / 'data' / 'dev.db').write_bytes(b'live database')
        (self.root / 'minework.env').write_text('live config')
        (self.root / 'cleanup-releases.py').write_text('current cleaner')
        self.active = {
            'Id': 'active-container', 'Image': 'active-image-id',
            'Config': {'Image': 'minework:20261019-current'},
            'State': {'Running': True, 'Status': 'running'},
            'Name': '/minework',
            'Mounts': [{'Type': 'bind', 'Source': str(self.root / 'data' / 'dev.db')}],
        }
        self.commands = []

    def docker(self, *args):
        self.commands.append(args)
        if args == ('container', 'ls', '-aq'): return 'active-container'
        if args == ('inspect', 'active-container'): return json.dumps([self.active])
        if args[:2] == ('image', 'ls'):
            return '\n'.join(json.dumps(item) for item in [
                {'Repository': 'minework', 'Tag': '20261019-current', 'ID': 'active-image-id'},
                {'Repository': 'workweave', 'Tag': '20261017-old', 'ID': 'old-image-id'},
                {'Repository': 'another-app', 'Tag': 'old', 'ID': 'unrelated-image-id'},
            ])
        return ''

    def run_cleanup(self, apply=False):
        output = io.StringIO()
        argv = ['cleanup-releases.py'] + (['--apply'] if apply else [])
        with patch.object(cleanup, 'ROOT', self.root), patch.object(cleanup, 'docker', self.docker), patch.object(cleanup, 'inspect', return_value=self.active), patch('sys.argv', argv), contextlib.redirect_stdout(output):
            cleanup.main()
        return output.getvalue()

    def test_latest_only_removes_backups_including_snapshots_without_relocating_live_data(self):
        for directory in ['backups/old', 'database-backups/older', 'releases/20261017-old']:
            path = self.root / directory
            path.mkdir(parents=True)
            (path / 'snapshot.db').write_bytes(b'old snapshot')
        for name in ['minework-old.tar.gz', 'workweave-old.zip', 'deploy-test.py', 'audit-test.py', 'verify-test.py', 'config.bak']:
            (self.root / name).write_text('old artifact')
        self.run_cleanup(apply=True)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'data', 'releases', 'minework.env', 'cleanup-releases.py'})
        self.assertEqual([p.name for p in (self.root / 'releases').iterdir()], ['20261019-current'])
        self.assertEqual((self.root / 'data' / 'dev.db').read_bytes(), b'live database')
        self.assertEqual((self.root / 'minework.env').read_text(), 'live config')
        self.assertIn(('image', 'rm', 'workweave:20261017-old'), self.commands)
        self.assertNotIn(('image', 'rm', 'minework:20261019-current'), self.commands)
        self.assertNotIn(('image', 'rm', 'another-app:old'), self.commands)
        self.run_cleanup(apply=True)  # Nothing is recreated or moved on a second run.
        self.assertFalse((self.root / 'database-backups').exists())

    def test_preview_does_not_remove_a_snapshot(self):
        backup = self.root / 'database-backups'
        backup.mkdir()
        snapshot = backup / 'old.db'
        snapshot.write_bytes(b'backup')
        plan = json.loads(self.run_cleanup())
        self.assertIn(str(backup), plan['remove_paths'])
        self.assertTrue(snapshot.exists())
        self.assertFalse(any(cmd[:2] == ('image', 'rm') for cmd in self.commands))

    def test_protected_mounts_and_descendants_and_parents_cannot_be_deleted(self):
        protected = {(self.root / 'data').resolve(), self.release.resolve()}
        for path in [self.root, self.root / 'data', self.root / 'data' / 'dev.db', self.release, self.release / 'main.js']:
            with self.assertRaises(RuntimeError): cleanup.checked_path(path, protected)
        link = self.root / 'linked.backup'
        link.symlink_to(self.root / 'data')
        with self.assertRaises(RuntimeError): cleanup.checked_path(link, protected)

    def test_backup_directory_mounted_by_another_application_is_protected(self):
        backup = self.root / 'database-backups'
        backup.mkdir()
        original_docker = self.docker
        other = {'Id': 'other', 'Image': 'other-image', 'Config': {'Image': 'other:latest'}, 'Name': '/other', 'State': {'Status': 'running'}, 'Mounts': [{'Type': 'bind', 'Source': str(backup)}]}
        def docker(*args):
            if args == ('container', 'ls', '-aq'): return 'active-container other'
            if args == ('inspect', 'active-container', 'other'): return json.dumps([self.active, other])
            return original_docker(*args)
        self.docker = docker
        with self.assertRaises(RuntimeError): self.run_cleanup(apply=True)
        self.assertTrue(backup.exists())


if __name__ == '__main__':
    unittest.main()
