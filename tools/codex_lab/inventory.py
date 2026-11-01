"""Read only header metadata, never message bodies, auth files, or database rows."""
from __future__ import annotations

from collections import Counter
import json
import os
from pathlib import Path
import stat

MAX_HEADER = 2 * 1024 * 1024


def classify_source(meta: dict) -> str:
    source, originator = meta.get('source'), meta.get('originator')
    if isinstance(source, dict) and 'subagent' in source:
        return 'subagent'
    # Desktop uses source=vscode too. Specific observed originator wins.
    if originator in {'codex_work_desktop', 'codex_desktop'}:
        return 'desktop'
    if source == 'cli':
        return 'cli'
    if source == 'vscode' and originator in {'codex_vscode', 'codex_ide'}:
        return 'ide'
    return 'unknown'


def read_header(path: Path) -> dict:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Not a regular rollout file')
        raw = stream.readline(MAX_HEADER + 1)
        if len(raw) > MAX_HEADER:
            raise ValueError('Metadata exceeds size limit')
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('File changed while reading')
    record = json.loads(raw)
    if record.get('type') != 'session_meta' or not isinstance(record.get('payload'), dict):
        raise ValueError('Unknown metadata format')
    return record['payload']


def inventory(home: Path) -> dict:
    counts, versions, modes, errors = Counter(), Counter(), Counter(), Counter()
    total, archived = 0, 0
    for folder in ('sessions', 'archived_sessions'):
        base = home / folder
        if base.is_symlink():
            errors['symlink_directory'] += 1
            continue
        for directory, dirs, names in os.walk(base, followlinks=False):
            dirs[:] = [d for d in dirs if not (Path(directory) / d).is_symlink()]
            for name in names:
                if not name.endswith('.jsonl'):
                    continue
                total += 1
                archived += folder == 'archived_sessions'
                try:
                    meta = read_header(Path(directory) / name)
                    counts[classify_source(meta)] += 1
                    versions[str(meta.get('cli_version', 'unknown'))] += 1
                    modes[str(meta.get('history_mode', 'unknown'))] += 1
                except (OSError, ValueError, TypeError):
                    errors['unreadable_or_changed'] += 1
    return {
        'rolloutCount': total, 'archivedCount': archived,
        'sources': dict(counts), 'versions': dict(versions),
        'historyModes': dict(modes), 'errors': dict(errors),
        'databaseFiles': sorted(p.name for p in home.glob('*.sqlite') if p.is_file() and not p.is_symlink()),
        'scope': 'rollout headers only; not a complete history or attachment audit',
    }


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-home', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(inventory(args.codex_home), ensure_ascii=False, indent=2))
