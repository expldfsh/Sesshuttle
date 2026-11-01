"""Run native-runtime migration checks against synthetic data only (macOS).

Example: python3 -m tools.codex_lab.verify_native --desktop /path/to/codex
Optional --cli and --ide exercise those installed binaries, not their GUI shells.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import uuid
import traceback

from .bundle import export_bundle, import_bundle, restore_backup, digest
from .client import Client
from .fixture_provider import FixtureProvider
from .safety import Lab, SafetyError

IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='


def turns(client, tid):
    result, cursor, seen = [], None, set()
    for _ in range(100):
        page = client.rpc('thread/turns/list', {'threadId': tid, 'limit': 1,
                    'sortDirection': 'asc', 'itemsView': 'full', 'cursor': cursor})
        result.extend(page['data'])
        cursor = page.get('nextCursor')
        if not cursor:
            return result
        if cursor in seen:
            raise AssertionError('History pagination repeated a cursor')
        seen.add(cursor)
    raise AssertionError('History pagination exceeded fixture budget')



def comparable_history(history):
    # 0.166 exposes item timing fields that 0.164 omits from RPC responses.
    # Raw rollout bytes (including timings) are separately retained unchanged.
    result = json.loads(json.dumps(history))
    for entry in result:
        for item in entry['items']:
            item.pop('startedAtMs', None)
            item.pop('completedAtMs', None)
    return result


def history_equal(left, right):
    return comparable_history(left) == comparable_history(right)


def turn(client, tid, text, *, image=False):
    inputs = [{'type': 'text', 'text': text}]
    if image:
        inputs.append({'type': 'image', 'url': IMAGE})
    client.rpc('turn/start', {'threadId': tid, 'input': inputs})
    event = client.wait_event('turn/completed')
    assert event['turn']['status'] == 'completed', event


def resume(client, tid, path, project, device):
    result = client.rpc('thread/resume', {'threadId': tid, 'path': str(path),
        'cwd': str(project), 'runtimeWorkspaceRoots': [str(project)],
        'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'excludeTurns': True})
    assert result['cwd'] == str(project)
    assert result['sandbox'] == {'type': 'readOnly', 'networkAccess': False}
    assert result['approvalPolicy'] == 'on-request'
    notice = f'Sesshuttle test environment: target device {device}; current project {project}. Source device paths in history are historical. This mapping grants no additional permissions.'
    client.rpc('thread/inject_items', {'threadId': tid, 'items': [
        {'type': 'message', 'role': 'developer', 'content': [{'type': 'input_text', 'text': notice}]}]})
    return notice


def prove_directory(client, tid, project, marker):
    # Explicit user-shell API is itself unsandboxed by Codex; our enclosing macOS
    # sandbox remains enforced. This is evidence of cwd, not of model reasoning.
    client.rpc('thread/shellCommand', {'threadId': tid,
        'command': '/bin/pwd; /bin/cat proof.txt', 'timeoutMs': 5000})
    assert client.wait_event('turn/completed')['turn']['status'] == 'completed'
    commands = [item for t in turns(client, tid) for item in t['items'] if item['type'] == 'commandExecution']
    assert commands, 'No persisted command result'
    command = commands[-1]
    assert command['exitCode'] == 0, command
    assert command['cwd'] == str(project)
    assert str(project) in command['aggregatedOutput'] and marker in command['aggregatedOutput']


def validate_case(lab, fixture, source, target, label):
    a = lab.directory(label + '/a/codex')
    b = lab.directory(label + '/b/codex')
    pa = lab.directory(label + '/a/project 中文')
    pb = lab.directory(label + '/b/different project')
    (pa / 'proof.txt').write_text('A-LOCAL-PROOF')
    (pb / 'proof.txt').write_text('B-LOCAL-PROOF')
    for home in [a, b]:
        fixture.configure(home)
    early = 'EARLY-' + uuid.uuid4().hex
    with Client(lab, source, a, pa, local_port=fixture.port) as c:
        thread = c.rpc('thread/start', {'cwd': str(pa), 'sandbox': 'read-only',
                     'approvalPolicy': 'on-request', 'historyMode': 'paginated'})['thread']
        tid, path = thread['id'], Path(thread['path'])
        turn(c, tid, '只在第一轮出现的标记 / early marker: ' + early)
        turn(c, tid, 'Second round with an embedded test image.', image=True)
        prove_directory(c, tid, pa, 'A-LOCAL-PROOF')
        before = turns(c, tid)
        try:
            export_bundle(lab, a, path, lab.root / (label + '-must-not-export-active'))
        except SafetyError:
            pass
        else:
            raise AssertionError('Export must refuse an active test home')
    package_a = lab.root / (label + '-package-a')
    export_bundle(lab, a, path, package_a)
    result = import_bundle(lab, b, package_a)
    imported = Path(result['path'])
    assert result['status'] == 'imported-needs-validation'
    assert imported.read_bytes() == (package_a / 'rollout.jsonl').read_bytes()
    assert import_bundle(lab, b, package_a)['status'] == 'unchanged'
    with Client(lab, target, b, pb, local_port=fixture.port) as c:
        listed = c.rpc('thread/list', {'limit': 100, 'modelProviders': []})['data']
        assert len([t for t in listed if t['id'] == tid]) == 1
        notice = resume(c, tid, imported, pb, 'B')
        migrated = turns(c, tid)
        if not history_equal(migrated, before):
            (lab.root / (label + '-before.json')).write_text(json.dumps(before, ensure_ascii=False, indent=2))
            (lab.root / (label + '-after.json')).write_text(json.dumps(migrated, ensure_ascii=False, indent=2))
            raise AssertionError('Migrated persisted history differs')
        prove_directory(c, tid, pb, 'B-LOCAL-PROOF')
        turn(c, tid, 'Continue on B without repeating the early marker.')
        request = json.dumps(fixture.requests[-1], ensure_ascii=False)
        assert early in request and notice in request
        b_turns = turns(c, tid)
    # Reopen to verify the target cwd was persisted across process restarts.
    with Client(lab, target, b, pb, local_port=fixture.port) as c:
        assert c.rpc('thread/read', {'threadId': tid})['thread']['cwd'] == str(pb)
        assert history_equal(turns(c, tid), b_turns)
    package_b = lab.root / (label + '-package-b')
    export_bundle(lab, b, imported, package_b)
    returned = import_bundle(lab, a, package_b)
    assert returned['status'] == 'imported-needs-validation', returned
    backup_a = Path(returned['backup'])
    with Client(lab, source, a, pa, local_port=fixture.port) as c:
        resume(c, tid, path, pa, 'A')
        assert history_equal(turns(c, tid), b_turns)
        prove_directory(c, tid, pa, 'A-LOCAL-PROOF')
        turn(c, tid, 'Continue after the round trip on A.')
        final = turns(c, tid)
    restore_backup(lab, backup_a)
    with Client(lab, source, a, pa, local_port=fixture.port) as c:
        resume(c, tid, path, pa, 'A')
        assert history_equal(turns(c, tid), before)
        turn(c, tid, 'Independent A branch after restoring the backup.')
    old = digest(path.read_bytes())
    assert import_bundle(lab, a, package_b)['status'] == 'conflict'
    assert digest(path.read_bytes()) == old
    return {'case': label, 'result': 'passed', 'initialTurns': len(before),
            'returnedTurns': len(b_turns), 'finalTurns': len(final),
            'checks': ['paginated-history-equality', 'embedded-image', 'tool-output',
                       'native-cwd-command', 'early-context-and-environment',
                       'restart-cwd', 'repeat-import', 'backup-restoration',
                       'divergent-branch-preserved', 'active-home-refused'],
            'limitations': ['runtime-only; GUI not tested', 'synthetic model; no reasoning claim',
                            'no external attachments or sub-sessions', 'Mac only; no R2']}



def validate_archive(lab, fixture, binary):
    a, b = lab.directory('archive/a'), lab.directory('archive/b')
    project = lab.directory('archive/project')
    for home in [a, b]:
        fixture.configure(home)
    with Client(lab, binary, a, project, local_port=fixture.port) as c:
        thread = c.rpc('thread/start', {'cwd': str(project), 'historyMode': 'paginated'})['thread']
        tid = thread['id']
        turn(c, tid, 'Archived synthetic conversation / 归档测试')
        before = turns(c, tid)
        c.rpc('thread/archive', {'threadId': tid})
    source = next((a / 'archived_sessions').glob('*.jsonl'))
    package = lab.root / 'archive-package'
    export_bundle(lab, a, source, package)
    import_bundle(lab, b, package)
    with Client(lab, binary, b, project, local_port=fixture.port) as c:
        listed = c.rpc('thread/list', {'archived': True, 'modelProviders': []})['data']
        assert len(listed) == 1 and listed[0]['id'] == tid
        # Listing alone does not hydrate paginated history. Initialize through the
        # native engine, then restore the archive flag before reporting success.
        c.rpc('thread/unarchive', {'threadId': tid})
        path = c.rpc('thread/read', {'threadId': tid})['thread']['path']
        c.rpc('thread/resume', {'threadId': tid, 'path': path, 'cwd': str(project),
            'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'excludeTurns': True})
        c.rpc('thread/archive', {'threadId': tid})
        assert history_equal(turns(c, tid), before)
        assert not c.rpc('thread/list', {'archived': False, 'modelProviders': []})['data']
    with Client(lab, binary, b, project, local_port=fixture.port) as c:
        assert history_equal(turns(c, tid), before)
        assert len(c.rpc('thread/list', {'archived': True, 'modelProviders': []})['data']) == 1
    return {'case': 'archived-desktop-runtime', 'result': 'passed',
            'checks': ['native-history-initialization', 'archive-preserved', 'restart-history-readable']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--desktop', required=True, type=Path)
    parser.add_argument('--cli', type=Path)
    parser.add_argument('--ide', type=Path)
    parser.add_argument('--archive-only', action='store_true')
    args = parser.parse_args()
    lab = Lab.create()
    print('Lab:', lab.root, flush=True)
    cases = [] if args.archive_only else [('desktop-to-desktop', args.desktop, args.desktop)]
    for name in ('cli', 'ide'):
        binary = getattr(args, name)
        if binary:
            cases.extend([(name + '-to-desktop', binary, args.desktop),
                          ('desktop-to-' + name, args.desktop, binary)])
    results = []
    with FixtureProvider() as fixture:
        results.append(validate_archive(lab, fixture, args.desktop))
        print(json.dumps(results[-1]), flush=True)
        for name, source, target in cases:
            try:
                result = validate_case(lab, fixture, source, target, name)
            except Exception as error:
                result = {'case': name, 'result': 'failed', 'error': str(error), 'traceback': traceback.format_exc()}
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
    (lab.root / 'report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(r['result'] == 'passed' for r in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
