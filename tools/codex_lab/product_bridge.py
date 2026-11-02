"""Synthetic provider bridge for the production JS engine round-trip check."""
import json
from pathlib import Path
import sys
import uuid
from .safety import Lab
from .fixture_provider import FixtureProvider
from .client import Client
from .verify_native import turn, turns, prove_directory, history_equal

lab = Lab.create()
a, b = lab.directory('a/codex'), lab.directory('b/codex')
pa, pb = lab.directory('a/project 中文'), lab.directory('b/project with spaces')
(pa / 'proof.txt').write_text('A-LOCAL-PROOF')
(pb / 'proof.txt').write_text('B-LOCAL-PROOF')
source, target = map(Path, sys.argv[1:3])
early = 'PRODUCT-EARLY-' + uuid.uuid4().hex
with FixtureProvider() as fixture:
    for home in (a, b): fixture.configure(home)
    with Client(lab, source, a, pa, local_port=fixture.port) as client:
        created = client.rpc('thread/start', {'cwd': str(pa), 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'historyMode': 'paginated'})['thread']
        tid = created['id']
        turn(client, tid, early)
        turn(client, tid, 'Embedded image round', image=True)
        prove_directory(client, tid, pa, 'A-LOCAL-PROOF')
        expected = turns(client, tid)
    print(json.dumps({'root': str(lab.root), 'a': str(a), 'b': str(b), 'pa': str(pa), 'pb': str(pb), 'tid': tid}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            side = request['side']
            home, project, binary = (b, pb, target) if side == 'B' else (a, pa, source)
            with Client(lab, binary, home, project, local_port=fixture.port) as client:
                assert client.rpc('thread/read', {'threadId': tid})['thread']['cwd'] == str(project)
                client.rpc('thread/resume', {'threadId': tid, 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'excludeTurns': True})
                actual = turns(client, tid)
                assert history_equal(actual, expected), 'Native history changed during product transfer'
                prove_directory(client, tid, project, side + '-LOCAL-PROOF')
                turn(client, tid, 'Continue on ' + side + ' without repeating the early marker')
                body = json.dumps(fixture.requests[-1], ensure_ascii=False)
                assert early in body and 'sesshuttle environment mapping' in body and str(project) in body
                expected = turns(client, tid)
            print(json.dumps({'ok': True, 'side': side, 'turns': len(expected), 'cwd': True, 'earlyContext': True, 'mappingInModelInput': True}), flush=True)
        except Exception as error:
            print(json.dumps({'ok': False, 'error': str(error)}), flush=True)
