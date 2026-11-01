"""Lossless, lab-only rollout packages with offline backup and conflict refusal.

This does not implement production migration: dependencies and GUI compatibility
must be established before any live-data adapter is enabled.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath
import uuid

from .safety import Lab, SafetyError

MAX_BYTES = 32 * 1024 * 1024
KNOWN_VERSIONS = {'0.164.0', '0.164.0-alpha.11.1', '0.166.0-alpha.5.1'}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@contextmanager
def exclusive_home(lab: Lab, home: Path):
    home = lab.checked(home)
    path = lab.directory('locks') / (digest(str(home).encode()) + '.lock')
    lab.checked(path)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'ab') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SafetyError('Test home is in use; stop its app-server first') from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def inspect_rollout(data: bytes) -> dict:
    if not data or len(data) > MAX_BYTES or not data.endswith(b'\n'):
        raise ValueError('Incomplete or oversized rollout')
    lines = data.splitlines()
    records = [json.loads(line) for line in lines]
    if not all(isinstance(record, dict) for record in records):
        raise ValueError('Invalid rollout records')
    first = records[0]
    if first.get('type') != 'session_meta':
        raise ValueError('Missing session metadata')
    meta = first.get('payload', {})
    uuid.UUID(meta['id'])
    if meta.get('cli_version') not in KNOWN_VERSIONS:
        raise ValueError('Unvalidated Codex version; import disabled')
    if meta.get('originator') != 'sesshuttle_lab':
        raise SafetyError('Only synthetic lab conversations may be packaged')
    if meta.get('parent_thread_id') or meta.get('forked_from_id'):
        raise ValueError('Dependent conversations are not covered by this experiment')
    # Reject external resource references; embedded image bytes remain unchanged.
    def check(value):
        if isinstance(value, dict):
            kind = value.get('type')
            if kind in {'input_audio', 'input_file', 'localImage', 'local_image', 'file'}:
                raise ValueError('External resources require a future dependency adapter')
            if kind in {'input_image', 'image'}:
                url = value.get('image_url', value.get('url', ''))
                if not isinstance(url, str) or not url.startswith('data:image/'):
                    raise ValueError('Only embedded images are supported in lab bundles')
            if value.get('file_id'):
                raise ValueError('Remote file reference is not self-contained')
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
    for record in records:
        check(record)
    return meta


def read_stable(lab: Lab, path: Path) -> bytes:
    path = lab.checked(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise SafetyError('Expected a regular, unlinked test file')
        if before.st_size > MAX_BYTES:
            raise ValueError('Research file exceeds size limit')
        data = stream.read(MAX_BYTES + 1)
        after = os.fstat(stream.fileno())
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError('Source changed during snapshot')
    return data


def export_bundle(lab: Lab, home: Path, rollout: Path, output: Path) -> dict:
    lab.checked(output)
    if not rollout.is_relative_to(home / 'sessions') and not rollout.is_relative_to(home / 'archived_sessions'):
        raise SafetyError('Expected a rollout in the isolated home')
    with exclusive_home(lab, home):
        raw = read_stable(lab, rollout)
        meta = inspect_rollout(raw)
        manifest = {'format': 1, 'threadId': meta['id'], 'sha256': digest(raw),
                    'bytes': len(raw), 'codexVersion': meta['cli_version'],
                    'archived': rollout.is_relative_to(home / 'archived_sessions'),
                    'scope': 'synthetic-self-contained-rollout'}
        output.mkdir(mode=0o700)
        (output / 'rollout.jsonl').write_bytes(raw)
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        return manifest


def verify_bundle(lab: Lab, package: Path) -> tuple[dict, bytes]:
    manifest = json.loads(read_stable(lab, package / 'manifest.json'))
    raw = read_stable(lab, package / 'rollout.jsonl')
    if manifest.get('format') != 1 or manifest.get('scope') != 'synthetic-self-contained-rollout':
        raise ValueError('Unsupported package format')
    if manifest.get('sha256') != digest(raw) or manifest.get('bytes') != len(raw):
        raise ValueError('Package integrity check failed')
    meta = inspect_rollout(raw)
    if meta['id'] != manifest.get('threadId') or meta['cli_version'] != manifest.get('codexVersion'):
        raise ValueError('Package identity mismatch')
    if type(manifest.get('archived')) is not bool:
        raise ValueError('Invalid archive status')
    return manifest, raw


def _backup(lab: Lab, home: Path) -> Path:
    destination = lab.directory('backups') / uuid.uuid4().hex
    files = []
    total = 0
    for directory, dirs, names in os.walk(home, followlinks=False):
        for name in [*dirs, *names]:
            lab.checked(Path(directory) / name)
        for name in names:
            file = Path(directory) / name
            data = read_stable(lab, file)
            total += len(data)
            if total > 128 * 1024 * 1024:
                raise SafetyError('Backup exceeds research disk budget')
            files.append((file.relative_to(home), data))
    destination.mkdir(mode=0o700)
    checksums = {}
    for relative, data in files:
        target = destination / 'home' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        checksums[str(relative)] = digest(data)
    (destination / 'backup.json').write_text(json.dumps({'home': str(home), 'files': checksums}))
    return destination


def import_bundle(lab: Lab, home: Path, package: Path) -> dict:
    home = lab.checked(home)
    manifest, raw = verify_bundle(lab, package)
    with exclusive_home(lab, home):
        candidates = []
        for folder in ('sessions', 'archived_sessions'):
            for path in (home / folder).rglob('*.jsonl'):
                if path.is_symlink():
                    raise SafetyError('Unexpected symbolic link')
                data = read_stable(lab, path)
                try:
                    if json.loads(data.splitlines()[0]).get('payload', {}).get('id') == manifest['threadId']:
                        candidates.append((path, data))
                except (ValueError, IndexError):
                    raise ValueError('Unreadable target rollout; refusing import')
        if len(candidates) > 1:
            raise ValueError('Ambiguous duplicate identity')
        if candidates:
            target, existing = candidates[0]
            if existing == raw:
                return {'status': 'unchanged', 'path': str(target), 'backup': None}
            if not raw.startswith(existing):
                # Preserve divergent incoming bytes in the immutable package; do not overwrite.
                return {'status': 'conflict', 'path': str(target), 'incoming': str(package), 'backup': None}
        else:
            folder = 'archived_sessions' if manifest['archived'] else 'sessions'
            timestamp = datetime.fromisoformat(inspect_rollout(raw)['timestamp'].replace('Z', '+00:00'))
            name = 'rollout-' + timestamp.strftime('%Y-%m-%dT%H-%M-%S-') + manifest['threadId'] + '.jsonl'
            parent = home / folder if manifest['archived'] else home / folder / timestamp.strftime('%Y/%m/%d')
            target = lab.checked(parent / name)
        backup = _backup(lab, home)
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = lab.checked(target.with_suffix('.staged-' + uuid.uuid4().hex))
        with stage.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        journal = backup / 'import.json'
        journal.write_text(json.dumps({'target': str(target), 'hash': digest(raw), 'state': 'prepared'}))
        os.replace(stage, target)
        journal.write_text(json.dumps({'target': str(target), 'hash': digest(raw), 'state': 'written-needs-native-validation'}))
        return {'status': 'imported-needs-validation', 'path': str(target), 'backup': str(backup)}


def restore_backup(lab: Lab, backup: Path) -> dict:
    info = json.loads(read_stable(lab, backup / 'backup.json'))
    home = lab.checked(Path(info['home']))
    with exclusive_home(lab, home):
        # Validate everything before changing the home, including every relative path.
        files = []
        for relative, checksum in info['files'].items():
            parts = PurePosixPath(relative)
            if parts.is_absolute() or '..' in parts.parts or not parts.parts or '\\' in relative:
                raise SafetyError('Invalid relative backup path')
            lab.checked(home / relative)
            candidate = lab.checked(backup / 'home' / relative)
            if not candidate.is_relative_to(backup / 'home'):
                raise SafetyError('Backup path escapes its snapshot')
            data = read_stable(lab, candidate)
            if digest(data) != checksum:
                raise ValueError('Backup integrity check failed')
            files.append((relative, data))
        staged = lab.directory('restore-' + uuid.uuid4().hex)
        for relative, data in files:
            target = lab.checked(staged / relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        previous = lab.checked(home.with_name(home.name + '.before-restore-' + uuid.uuid4().hex))
        os.replace(home, previous)
        try:
            os.replace(staged, home)
        except BaseException:
            os.replace(previous, home)
            raise
        # Preserve displaced test data too; this tool never recursively deletes homes.
        return {'status': 'restored-needs-validation', 'preserved': str(previous)}
