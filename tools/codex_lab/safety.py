"""Fail-closed filesystem and process boundary for Mac compatibility tests."""
from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import tempfile

MARKER = '.sesshuttle-lab.json'


class SafetyError(ValueError):
    pass


class Lab:
    def __init__(self, root: Path):
        self.root = Path(root).absolute()
        if self.root.is_symlink() or self.root != self.root.resolve():
            raise SafetyError('Lab root must be canonical, without symbolic links')
        temp = Path(tempfile.gettempdir()).resolve()
        if self.root.parent != temp or not self.root.name.startswith('sesshuttle-lab-'):
            raise SafetyError('Writes are restricted to a dedicated temporary lab')
        marker = self.root / MARKER
        if marker.is_symlink() or not marker.is_file():
            raise SafetyError('Missing lab ownership marker')
        if json.loads(marker.read_text()) != {'format': 1, 'purpose': 'synthetic-tests-only'}:
            raise SafetyError('Invalid lab ownership marker')

    @classmethod
    def create(cls) -> Lab:
        root = Path(tempfile.mkdtemp(prefix='sesshuttle-lab-')).resolve()
        (root / MARKER).write_text(json.dumps({'format': 1, 'purpose': 'synthetic-tests-only'}))
        return cls(root)

    def checked(self, path: Path) -> Path:
        path = Path(path).absolute()
        if not path.is_relative_to(self.root) or path == self.root:
            raise SafetyError('Path is outside the lab')
        if path.resolve() != path:
            raise SafetyError('Symbolic links and path traversal are not allowed')
        # Resolve also rejects dangling symlink escapes. All lab files stay private.
        for parent in [path, *path.parents]:
            if parent == self.root:
                break
            if parent.is_symlink():
                raise SafetyError('Symbolic links are not allowed')
        if path.is_file() and path.stat().st_nlink != 1:
            raise SafetyError('Hard-linked files are not allowed in the lab')
        return path

    def directory(self, relative: str) -> Path:
        path = self.checked(self.root / relative)
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        return path

    def environment(self, home: Path) -> dict[str, str]:
        self.checked(home)
        # Never inherit credentials, proxy configuration, or the user's CODEX_HOME.
        return {
            'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',
            'CODEX_HOME': str(home),
            'TMPDIR': str(self.directory('tmp')),
            'XDG_CONFIG_HOME': str(self.directory('xdg/config')),
            'XDG_CACHE_HOME': str(self.directory('xdg/cache')),
            'XDG_DATA_HOME': str(self.directory('xdg/data')),
            'RUST_LOG': 'error',
        }

    def command(self, arguments: list[str], *, local_port: int | None = None) -> list[str]:
        if platform.system() == 'Linux':
            marker = Path('/run/sesshuttle-isolated-vm')
            if not marker.is_file() or marker.stat().st_uid != 0 or marker.read_text().strip() != 'loopback-only-fixture':
                raise SafetyError('Linux native tests require the disposable VM with loopback-only outbound policy')
            return ['/usr/bin/bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
                    '--tmpfs', '/home', '--tmpfs', '/tmp', '--bind', str(self.root), str(self.root), '--', *arguments]
        if platform.system() != 'Darwin' or not Path('/usr/bin/sandbox-exec').is_file():
            raise SafetyError('This research runner requires the macOS process sandbox')
        root = json.dumps(str(self.root))
        real_data = json.dumps(str((Path.home() / '.codex').resolve()))
        profile = (
            '(version 1)(deny default)(allow process*)(allow sysctl-read)'
            '(allow mach-lookup)(allow ipc-posix*)(allow file-read*)'
            f'(deny file-read* (subpath {real_data}))'
            f'(allow file-write* (subpath {root}) (literal "/dev/null"))'
        )
        if local_port is not None:
            if not 1024 <= local_port <= 65535:
                raise SafetyError('Invalid fixture server port')
            profile += f'(allow network-outbound (remote ip "localhost:{local_port}"))'
        return ['/usr/bin/sandbox-exec', '-p', profile, *arguments]
