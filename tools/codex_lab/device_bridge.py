"""One side of an isolated cross-OS fixture. Authentication and model replies stay local."""
import json
import sys
import uuid
from pathlib import Path
from .safety import Lab
from .client import Client
from .fixture_provider import FixtureProvider
from .verify_native import turns, turn, prove_directory

mode, executable, previous_root, previous_tid, marker = sys.argv[1:]
lab = Lab(Path(previous_root)) if mode == 'return' else Lab.create()
home, project = lab.directory('codex'), lab.directory('working copy')
(project / 'proof.txt').write_text(mode + '-LOCAL')
tid, project_id = previous_tid, None
with FixtureProvider() as service:
    service.configure(home)
    with Client(lab, Path(executable), home, project, local_port=service.port) as c:
        if mode == 'source':
            tid = c.rpc('thread/start', {'cwd': str(project), 'sandbox': 'read-only', 'approvalPolicy': 'on-request', 'historyMode': 'paginated'})['thread']['id']
            turn(c, tid, marker)
            turn(c, tid, 'Keep the small fixture image', image=True)
            prove_directory(c, tid, project, 'source-LOCAL')
        if mode == 'receive':
            project_id = c.rpc('project/create', {'name':'linux','roots':[{'path':str(project)}],'idempotencyKey':uuid.uuid4().hex})['project']['id']
            assert not c.rpc('thread/list', {'projectId':project_id,'modelProviders':[]})['data']
    print(json.dumps({'root':str(lab.root),'home':str(home),'project':str(project),'tid':tid,'projectId':project_id}),flush=True)
    for line in sys.stdin:
        with Client(lab, Path(executable), home, project, local_port=service.port) as c:
            result=c.rpc('thread/read', {'threadId':tid})['thread']
            assert result['cwd']==str(project)
            if project_id:
                assert result['projectId']==project_id
                assert tid in [r['id'] for r in c.rpc('thread/list',{'projectId':project_id,'modelProviders':[]})['data']]
            c.rpc('thread/resume',{'threadId':tid,'cwd':str(project),'sandbox':'read-only','approvalPolicy':'on-request','excludeTurns':True})
            before=turns(c,tid)
            prove_directory(c,tid,project,mode+'-LOCAL')
            turn(c,tid,'I switched computers. Here is the working folder: '+str(project))
            after=turns(c,tid); body=json.dumps(service.requests[-1])
            assert marker in body and 'sesshuttle environment mapping' not in body and len(after)==len(before)+2
            print(json.dumps({'before':len(before),'after':len(after),'projectVerified':bool(project_id),'cwdVerified':True,'manualHandoff':True}),flush=True)
