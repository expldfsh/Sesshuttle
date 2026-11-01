"""Verify macOS confinement using a disposable sentinel, never user files."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

from .safety import Lab


def verify_boundary(lab: Lab):
    outside = Path(tempfile.mkdtemp(prefix='sesshuttle-sentinel-')) / 'keep.txt'
    outside.write_text('unchanged')
    with socket.socket() as allowed, socket.socket() as blocked:
        allowed.bind(('127.0.0.1', 0))
        blocked.bind(('127.0.0.1', 0))
        allowed.listen()
        blocked.listen()
        allowed_port, blocked_port = allowed.getsockname()[1], blocked.getsockname()[1]
        code = '''
import pathlib, socket, sys
inside, outside, real_home, allowed, blocked = sys.argv[1:]
pathlib.Path(inside).write_text('inside-only')
try:
    pathlib.Path(outside).write_text('boundary-failed')
except PermissionError:
    pass
else:
    raise AssertionError('Outside writes were allowed')
try:
    list(pathlib.Path(real_home).iterdir())
except PermissionError:
    pass
else:
    raise AssertionError('Live Codex data could be read')
with socket.create_connection(('127.0.0.1', int(allowed)), timeout=2):
    pass
try:
    connection = socket.create_connection(('127.0.0.1', int(blocked)), timeout=2)
except PermissionError:
    pass
else:
    connection.close()
    raise AssertionError('Unlisted network port was allowed')
'''
        command = lab.command([sys.executable, '-c', code, str(lab.root / 'inside.txt'),
            str(outside), str(Path.home() / '.codex'), str(allowed_port), str(blocked_port)], local_port=allowed_port)
        result = subprocess.run(command, cwd=lab.root, env=lab.environment(lab.directory('boundary-home')),
                                capture_output=True, text=True, timeout=10)
        assert result.returncode == 0, result.stderr
        assert outside.read_text() == 'unchanged'
        assert (lab.root / 'inside.txt').read_text() == 'inside-only'
    return {'result': 'passed', 'checks': ['outside-writes-denied', 'live-codex-reads-denied',
                                         'only-designated-loopback-port-allowed']}


if __name__ == '__main__':
    print(json.dumps(verify_boundary(Lab.create())))
