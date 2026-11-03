"""Bounded JSON-RPC client; every launched process is confined to a Lab."""
from __future__ import annotations

import json
import os
from pathlib import Path
import selectors
import subprocess
import time

from .safety import Lab, SafetyError
from .bundle import exclusive_home


class RpcError(RuntimeError):
    def __init__(self, method: str, error: dict):
        self.method, self.error = method, error
        super().__init__(f'{method}: {error}')


class Client:
    def __init__(self, lab: Lab, binary: Path, home: Path, project: Path,
                 *, local_port: int | None = None, local_openai: bool = False):
        self.lab, self.home = lab, lab.checked(home)
        self.project = lab.checked(project)
        if not home.is_dir() or not project.is_dir():
            raise SafetyError('Home and project must exist inside the lab')
        if (home / 'auth.json').exists():
            raise SafetyError('Test homes must not contain authentication credentials')
        args = [str(binary.resolve()), 'app-server', '-c', 'cli_auth_credentials_store="file"',
                '-c', 'analytics.enabled=false', '-c', 'shell_snapshot=false']
        self.log_path = lab.checked(home / 'app-server.stderr.log')
        self.lock = exclusive_home(lab, home)
        self.lock.__enter__()
        self.log = self.log_path.open('ab')
        try:
            self.process = subprocess.Popen(lab.command(args, local_port=local_port),
                cwd=project, env={**lab.environment(home), **({'OPENAI_API_KEY': 'sesshuttle-local-fixture-only', 'CODEX_API_KEY': 'sesshuttle-local-fixture-only'} if local_openai and local_port else {})}, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=self.log)
        except BaseException:
            self.log.close()
            self.lock.__exit__(None, None, None)
            raise
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b''
        self.counter = 0
        self.events: list[dict] = []
        try:
            result = self.rpc('initialize', {'clientInfo': {'name': 'sesshuttle_lab', 'version': '0.1.0'},
                                           'capabilities': {'experimentalApi': True}})
            if Path(result['codexHome']).resolve() != home:
                raise SafetyError('Server did not honor the isolated data location')
            self.notify('initialized')
        except BaseException:
            self.close()
            raise

    def _send(self, msg: dict):
        self.process.stdin.write((json.dumps(msg) + '\n').encode())
        self.process.stdin.flush()

    def notify(self, method: str, params: dict | None = None):
        self._send({'method': method, **({'params': params} if params is not None else {})})

    def _next(self, deadline: float) -> dict:
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                raise TimeoutError('App-server response deadline exceeded')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError('App-server exited; inspect isolated stderr log')
            self.buffer += chunk
            if len(self.buffer) > 32 * 1024 * 1024:
                raise SafetyError('RPC response exceeded research memory budget')
        raw, self.buffer = self.buffer.split(b'\n', 1)
        return json.loads(raw)

    def _event(self, msg: dict):
        if 'id' in msg and 'method' in msg:
            # Never approve a tool, login, or permission request during testing.
            self._send({'id': msg['id'], 'error': {'code': -32603, 'message': 'Lab denies approval'}})
        else:
            self.events.append(msg)
            if len(self.events) > 10000:
                raise SafetyError('Too many notifications')

    def rpc(self, method: str, params: dict, timeout: float = 20) -> dict:
        self.counter += 1
        call_id = self.counter
        self._send({'id': call_id, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        while True:
            msg = self._next(deadline)
            if msg.get('id') == call_id and 'method' not in msg:
                if 'error' in msg:
                    raise RpcError(method, msg['error'])
                return msg['result']
            self._event(msg)

    def wait_event(self, method: str, timeout: float = 30) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            for index, msg in enumerate(self.events):
                if msg.get('method') == method:
                    return self.events.pop(index)['params']
            self._event(self._next(deadline))

    def close(self):
        try:
            if self.process.poll() is None:
                self.process.stdin.close()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait(timeout=3)
        finally:
            self.selector.close()
            self.process.stdout.close()
            if not self.process.stdin.closed:
                self.process.stdin.close()
            self.log.close()
            self.lock.__exit__(None, None, None)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
