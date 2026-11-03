"""Synthetic missing-image continuation. All writes stay inside a Lab; loopback provider only."""
import base64
import json
from pathlib import Path
import sys
import uuid
from .safety import Lab
from .fixture_provider import FixtureProvider
from .client import Client
from .verify_native import turn, turns, prove_directory, comparable_history, IMAGE

lab = Lab.create()
a, b = lab.directory('a/codex'), lab.directory('b/codex')
pa, pb = lab.directory('a/project 中文'), lab.directory('b/project with spaces')
(pa / 'proof.txt').write_text('A-LOCAL-PROOF')
(pb / 'proof.txt').write_text('B-LOCAL-PROOF')
source, target = map(Path, sys.argv[1:3])
early = 'MISSING-IMAGE-EARLY-' + uuid.uuid4().hex
image = lab.directory('a/codex/uploads') / 'test.png'
image.write_bytes(base64.b64decode(IMAGE.split(',')[1]))
with FixtureProvider() as fixture:
    for home in (a, b): fixture.configure(home)
    with Client(lab, source, a, pa, local_port=fixture.port) as client:
        tid = client.rpc('thread/start', {'cwd': str(pa), 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'historyMode': 'paginated'})['thread']['id']
        turn(client, tid, early)
        client.rpc('turn/start', {'threadId': tid, 'input': [{'type': 'text', 'text': 'Keep this image message text exactly. 中文保留。'}, {'type': 'localImage', 'path': str(image)}]})
        assert client.wait_event('turn/completed')['turn']['status'] == 'completed'
        prove_directory(client, tid, pa, 'A-LOCAL-PROOF')
        expected = turns(client, tid)
    image.rename(image.with_suffix('.preserved'))
    assert not image.exists()
    print(json.dumps({'root': str(lab.root), 'a': str(a), 'b': str(b), 'pa': str(pa), 'pb': str(pb), 'tid': tid}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            side = request['side']
            home, project, binary = (b, pb, target) if side == 'B' else (a, pa, source)
            with Client(lab, binary, home, project, local_port=fixture.port) as client:
                client.rpc('thread/resume', {'threadId': tid, 'cwd': str(project), 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'excludeTurns': True})
                actual = turns(client, tid)
                before = comparable_history(expected)
                after = comparable_history(actual)
                # Only the explicit local-image input may change. Every other
                # field/item remains, including all user text and tool results.
                replaced = 0
                def replace_images(v):
                    global replaced
                    if isinstance(v, dict):
                        if v.get('type') in ('localImage', 'local_image') and v.get('path') == str(image):
                            v.clear()
                            v.update({'type': 'text', 'text': request['placeholder'], 'text_elements': []})
                            replaced += 1
                        else:
                            for x in v.values(): replace_images(x)
                    elif isinstance(v, list):
                        for x in v: replace_images(x)
                if side == 'B': replace_images(before)
                assert before == after, 'Native history differs beyond the confirmed image replacement'
                if side == 'B': assert replaced > 0
                prove_directory(client, tid, project, side + '-LOCAL-PROOF')
                turn(client, tid, 'Continue without needing the omitted image; do not repeat the early marker.')
                body = json.dumps(fixture.requests[-1], ensure_ascii=False)
                assert early in body and 'sesshuttle environment mapping' not in body
                expected = turns(client, tid)
            print(json.dumps({'ok': True, 'side': side, 'turns': len(expected), 'cwd': True, 'earlyContext': True, 'textAndToolHistoryPreserved': True, 'imageReplaced': replaced}), flush=True)
        except Exception as error:
            print(json.dumps({'ok': False, 'error': str(error)}), flush=True)
