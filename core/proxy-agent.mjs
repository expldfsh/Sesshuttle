// Connections to the storage endpoint that follow the proxy the system is set to use.
// Node itself ignores that setting, so on a computer that reaches the internet through
// a proxy every request would fail. The proxy only carries the encrypted connection:
// TLS is still negotiated with the endpoint itself, inside the tunnel.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// The routes in a resolver's answer, in order: "PROXY host:port; DIRECT". `null` is a
// direct connection. SOCKS proxies are not supported and are skipped.
export function proxyRoutes(answer) {
  const routes = [];
  for (const part of String(answer ?? '').split(';')) {
    const [, kind, host, port] =
      part.trim().match(/^(DIRECT|PROXY|HTTPS)(?:\s+(\[[^\]]+\]|[^\s:]+):(\d{1,5}))?$/i) ?? [];
    if (/^DIRECT$/i.test(kind ?? '')) routes.push(null);
    else if (kind && host && Number(port) > 0 && Number(port) < 65536)
      routes.push({
        host: host.replace(/^\[|\]$/g, ''),
        port: Number(port),
        secure: /^HTTPS$/i.test(kind),
      });
  }
  return routes;
}

// Asks the proxy for a tunnel to the endpoint and resolves with the open socket.
function tunnel(proxy, target, timeout) {
  return new Promise((resolve, reject) => {
    const authority =
      (target.host.includes(':') ? `[${target.host}]` : target.host) + ':' + target.port;
    const request = (proxy.secure ? https : http).request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: { host: authority },
      agent: false,
      timeout,
    });
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        return reject(new Error('The proxy refused the connection: ' + response.statusCode));
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    request.once('timeout', () => request.destroy(new Error('The proxy did not answer')));
    request.once('error', reject);
    request.end();
  });
}

// `resolve(url)` answers like a PAC script; Electron's session.resolveProxy does. It is
// asked for every new connection, so a proxy switched on or off later is followed.
export class ProxyAwareAgent extends https.Agent {
  constructor(resolve, options = {}) {
    super({ keepAlive: true, maxSockets: 50, ...options });
    this.resolveProxy = resolve;
  }
  createConnection(options, callback) {
    const target = { host: options.host ?? options.hostname, port: Number(options.port) || 443 };
    const direct = () => super.createConnection(options);
    const connect = async () => {
      // An answer that cannot be read or names no usable proxy means a direct connection.
      const answer = await Promise.resolve()
        .then(() => this.resolveProxy(`https://${target.host}:${target.port}/`))
        .catch(() => 'DIRECT');
      const routes = proxyRoutes(answer);
      if (!routes.length) return direct();
      let failure;
      for (const proxy of routes) {
        if (!proxy) return direct();
        try {
          const socket = await tunnel(proxy, target, options.timeout || 6000);
          return tls.connect({
            ...options,
            socket,
            servername:
              options.servername || (/^[\d.:]+$/.test(target.host) ? undefined : target.host),
          });
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    };
    connect().then(
      (socket) => callback(null, socket),
      (error) => callback(error),
    );
  }
}
