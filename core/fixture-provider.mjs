// A loopback Responses endpoint that answers every request with one fixed reply,
// and the Codex configuration that points a private data folder at it. Used by
// the in-app runtime check and the validation scripts. No account, model or
// external network is involved.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { id } from './util.mjs';

export const FIXTURE_REPLY = 'Sesshuttle local test reply';

// Every accepted request body is kept in `requests`, in order.
export async function startFixtureProvider({ maxRequestBytes = 4 * 1024 * 1024 } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.writeHead(404).end();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxRequestBytes) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      const text = FIXTURE_REPLY,
        msgId = 'msg_' + id();
      const item = {
        id: msgId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        phase: 'final_answer',
        content: [{ type: 'output_text', text, annotations: [] }],
      };
      const response = {
        id: 'resp_' + id(),
        object: 'response',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      };
      const events = [
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] },
        },
        {
          type: 'response.content_part.added',
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        },
        {
          type: 'response.output_text.delta',
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          delta: text,
        },
        {
          type: 'response.output_text.done',
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          text,
        },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response },
      ];
      res
        .writeHead(200, { 'content-type': 'text/event-stream' })
        .end(
          events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''),
        );
    } catch {
      res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// Points `home` at the fixture: read-only sandbox, no analytics, no retries.
export async function writeFixtureConfig(home, port) {
  await fs.writeFile(
    path.join(home, 'config.toml'),
    `model_provider = "sesshuttle_fixture"
model = "gpt-6.1-sol"
cli_auth_credentials_store = "file"
sandbox_mode = "read-only"
approval_policy = "on-request"
[analytics]
enabled = false
[model_providers.sesshuttle_fixture]
name = "Sesshuttle local test"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
`,
    { mode: 0o600 },
  );
}

// A new private data folder `root/name` configured for the fixture.
export async function setupHome(root, name, port) {
  const home = path.join(root, name);
  await fs.mkdir(home, { mode: 0o700 });
  await writeFixtureConfig(home, port);
  return home;
}
