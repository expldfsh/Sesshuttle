import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { ProxyAwareAgent, proxyRoutes } from '../../core/proxy-agent.mjs';
import { R2Store } from '../../core/storage.mjs';
import { temporaryCertificate } from '../helpers/tls.mjs';

test('a resolver answer is read as routes in the order to try them', () => {
  const proxy = (host, port, secure = false) => ({ host, port, secure });
  assert.deepEqual(proxyRoutes('DIRECT'), [null]);
  assert.deepEqual(proxyRoutes('PROXY 127.0.0.1:7890'), [proxy('127.0.0.1', 7890)]);
  assert.deepEqual(proxyRoutes('PROXY proxy.example:8080; DIRECT'), [
    proxy('proxy.example', 8080),
    null,
  ]);
  assert.deepEqual(proxyRoutes('HTTPS secure.example:443;PROXY [::1]:3128'), [
    proxy('secure.example', 443, true),
    proxy('::1', 3128),
  ]);
  // A SOCKS proxy cannot be used and is passed over for the next route.
  assert.deepEqual(proxyRoutes('SOCKS5 127.0.0.1:1080; PROXY 127.0.0.1:7890; DIRECT'), [
    proxy('127.0.0.1', 7890),
    null,
  ]);
  for (const unusable of ['', undefined, 'SOCKS 127.0.0.1:1080', 'PROXY nowhere', 'PROXY a:0'])
    assert.deepEqual(proxyRoutes(unusable), [], String(unusable));
});

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

// An HTTP proxy that tunnels to the address it is asked for and notes each request.
function tunnellingProxy(refuse = false) {
  const tunnels = [],
    sockets = new Set();
  const server = http.createServer((_request, response) => response.writeHead(400).end());
  server.on('connect', (request, socket, head) => {
    tunnels.push(request.url);
    if (refuse) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const [host, port] = request.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    for (const end of [socket, upstream]) {
      sockets.add(end);
      end.on('error', () => {});
      end.on('close', () => sockets.delete(end));
    }
  });
  return { server, tunnels, stop: () => (sockets.forEach((s) => s.destroy()), close(server)) };
}

const certificate = temporaryCertificate();

test(
  'a connection follows the proxy the system names, each time one is opened',
  { skip: !certificate && 'no openssl program to make a test certificate' },
  async (t) => {
    const origin = https.createServer(certificate, (request, response) =>
      response.end('reached ' + request.url),
    );
    const port = await listen(origin);
    const proxy = tunnellingProxy(),
      refusing = tunnellingProxy(true);
    const proxyPort = await listen(proxy.server),
      refusingPort = await listen(refusing.server);
    // A port nothing listens on: a proxy that was switched off.
    const idle = net.createServer();
    const closedPort = await listen(idle);
    await close(idle);
    let answer = 'DIRECT';
    const asked = [];
    const agent = new ProxyAwareAgent(
      async (url) => {
        asked.push(url);
        if (answer instanceof Error) throw answer;
        return answer;
      },
      { ca: certificate.cert, keepAlive: false },
    );
    t.after(async () => {
      agent.destroy();
      await Promise.all([close(origin), proxy.stop(), refusing.stop()]);
    });
    const get = (path) =>
      new Promise((resolve, reject) => {
        const request = https.get({ host: '127.0.0.1', port, path, agent }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () => resolve(body));
        });
        request.on('error', reject);
      });

    assert.equal(await get('/direct'), 'reached /direct');
    assert.deepEqual(proxy.tunnels, []);
    assert.deepEqual(asked, [`https://127.0.0.1:${port}/`]);

    // The proxy only sees where the encrypted connection goes.
    answer = 'PROXY 127.0.0.1:' + proxyPort;
    assert.equal(await get('/tunnelled'), 'reached /tunnelled');
    assert.deepEqual(proxy.tunnels, [`127.0.0.1:${port}`]);

    // A proxy that is gone is passed over when the answer allows another route.
    answer = `PROXY 127.0.0.1:${closedPort}; PROXY 127.0.0.1:${proxyPort}`;
    assert.equal(await get('/second'), 'reached /second');
    assert.equal(proxy.tunnels.length, 2);
    answer = `PROXY 127.0.0.1:${closedPort}; DIRECT`;
    assert.equal(await get('/fallback'), 'reached /fallback');
    assert.equal(proxy.tunnels.length, 2);

    // Without another route the request fails instead of leaving the proxy out.
    answer = 'PROXY 127.0.0.1:' + closedPort;
    await assert.rejects(get('/unreachable'));
    answer = 'PROXY 127.0.0.1:' + refusingPort;
    await assert.rejects(get('/refused'), /refused the connection: 403/);
    assert.deepEqual(refusing.tunnels, [`127.0.0.1:${port}`]);

    // A resolver that fails, or names nothing usable, leaves the direct connection.
    answer = new Error('no proxy service');
    assert.equal(await get('/unresolved'), 'reached /unresolved');
    answer = 'SOCKS5 127.0.0.1:' + closedPort;
    assert.equal(await get('/socks'), 'reached /socks');
    assert.equal(proxy.tunnels.length, 2);
  },
);

test(
  'the storage client reads and writes through the proxy',
  { skip: !certificate && 'no openssl program to make a test certificate' },
  async (t) => {
    const objects = new Map();
    const origin = https.createServer(certificate, async (request, response) => {
      const url = new URL(request.url, 'https://127.0.0.1');
      const key = decodeURIComponent(url.pathname);
      if (request.method === 'PUT') {
        const parts = [];
        for await (const part of request) parts.push(part);
        objects.set(key, Buffer.concat(parts));
        response.setHeader('ETag', '"fixture"');
        return response.end();
      }
      const body = objects.get(key);
      if (!body) return response.writeHead(404).end();
      response.setHeader('ETag', '"fixture"');
      response.setHeader('Content-Length', body.length);
      response.end(body);
    });
    const port = await listen(origin);
    const proxy = tunnellingProxy();
    const proxyPort = await listen(proxy.server);
    const store = new R2Store(
      {
        endpoint: `https://127.0.0.1:${port}`,
        bucket: 'fixture-bucket',
        accessKeyId: 'synthetic-access',
        secretAccessKey: 'synthetic-secret',
      },
      { allowLocal: true, proxy: async () => 'PROXY 127.0.0.1:' + proxyPort, ca: certificate.cert },
    );
    t.after(async () => {
      store.client.destroy();
      await Promise.all([close(origin), proxy.stop()]);
    });
    await store.put('sesshuttle/probe/one', Buffer.from('through the tunnel'), null);
    assert.equal((await store.get('sesshuttle/probe/one')).body.toString(), 'through the tunnel');
    assert.equal(await store.get('sesshuttle/probe/missing'), null);
    assert.ok(proxy.tunnels.length >= 1);
    assert.ok(proxy.tunnels.every((target) => target === `127.0.0.1:${port}`));
  },
);
