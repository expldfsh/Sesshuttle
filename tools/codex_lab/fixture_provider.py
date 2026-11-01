"""Deterministic loopback Responses fixture. No account, model, or external calls."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import uuid


class FixtureProvider:
    def __init__(self):
        self.requests: list[dict] = []
        provider = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > 8 * 1024 * 1024:
                    self.send_error(413)
                    return
                body = json.loads(self.rfile.read(size))
                provider.requests.append(body)
                identifier = 'msg_' + uuid.uuid4().hex
                text = 'Synthetic fixture response / 合成测试回复。'
                item = {'id': identifier, 'type': 'message', 'role': 'assistant',
                        'status': 'completed', 'phase': 'final_answer',
                        'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}
                response = {'id': 'resp_' + uuid.uuid4().hex, 'object': 'response',
                            'status': 'completed', 'output': [item],
                            'usage': {'input_tokens': 10, 'output_tokens': 10, 'total_tokens': 20}}
                events = [
                    {'type': 'response.created', 'response': {**response, 'status': 'in_progress', 'output': []}},
                    {'type': 'response.output_item.added', 'output_index': 0, 'item': {**item, 'status': 'in_progress', 'content': []}},
                    {'type': 'response.content_part.added', 'item_id': identifier, 'output_index': 0, 'content_index': 0,
                     'part': {'type': 'output_text', 'text': '', 'annotations': []}},
                    {'type': 'response.output_text.delta', 'item_id': identifier, 'output_index': 0, 'content_index': 0, 'delta': text},
                    {'type': 'response.output_text.done', 'item_id': identifier, 'output_index': 0, 'content_index': 0, 'text': text},
                    {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                    {'type': 'response.completed', 'response': response},
                ]
                data = ''.join('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n' for event in events).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def port(self) -> int:
        return self.server.server_port

    def configure(self, home):
        (home / 'config.toml').write_text(f'''model_provider = "sesshuttle_fixture"
model = "gpt-6.1-sol"
cli_auth_credentials_store = "file"
sandbox_mode = "read-only"
approval_policy = "on-request"
[analytics]
enabled = false
[model_providers.sesshuttle_fixture]
name = "Local synthetic fixture"
base_url = "http://127.0.0.1:{self.port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
''')

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
