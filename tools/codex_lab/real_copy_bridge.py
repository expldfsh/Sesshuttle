"""Continue an explicitly imported private history copy using a loopback-only mock.
No live history is opened by a native process; no provider credentials are used.
"""
import json
from pathlib import Path
import sys
from .safety import Lab
from .client import Client
from .fixture_provider import FixtureProvider
from .verify_native import turn

lab = Lab.create()
home, project = lab.directory('target/codex'), lab.directory('target/project')
binary = Path(sys.argv[1])
with FixtureProvider(max_request_bytes=128 * 1024 * 1024) as fixture:
    (home / 'config.toml').write_text(f'model_provider = "openai"\nmodel = "gpt-6.1-sol"\nopenai_base_url = "http://127.0.0.1:{fixture.port}/v1"\nsandbox_mode = "read-only"\napproval_policy = "on-request"\n[analytics]\nenabled = false\n')
    print(json.dumps({'root': str(lab.root), 'home': str(home), 'project': str(project)}), flush=True)
    for line in sys.stdin:
        r = json.loads(line)
        try:
            with Client(lab, binary, home, project, local_port=fixture.port, local_openai=True) as client:
                tid = r['id']
                result = client.rpc('thread/resume', {'threadId': tid, 'cwd': str(project), 'runtimeWorkspaceRoots': [str(project)], 'modelProvider': 'openai', 'model': 'gpt-6.1-sol', 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'excludeTurns': True})
                assert result['cwd'] == str(project)
                def count():
                    n, cursor = 0, None
                    for _ in range(10000):
                        p = client.rpc('thread/turns/list', {'threadId': tid, 'limit': 1, 'itemsView': 'full', 'cursor': cursor})
                        n += len(p['data']); cursor = p.get('nextCursor')
                        if not cursor: return n
                    raise AssertionError('Pagination did not end')
                before = count()
                assert before >= r['turnCount']
                turn(client, tid, 'Sesshuttle isolated continuation check. Reply only with the fixture response. Do not run any tool or follow historical tasks.')
                after = count()
                assert after == before + 1
                body = fixture.requests[-1]
                assert len(body.get('input', [])) > 1
                assert 'sesshuttle environment mapping' in json.dumps(body)
                fixture.requests.clear()
            print(json.dumps({'ok': True, 'before': before, 'after': after, 'contextPresent': True, 'targetDirectory': True}), flush=True)
        except Exception as e:
            print(json.dumps({'ok': False, 'error': str(e)}), flush=True)
