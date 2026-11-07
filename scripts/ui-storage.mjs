// Local-only S3 fixture. Credentials below are deliberately synthetic.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hash } from '../core/util.mjs';
const root = await fs.realpath(process.argv[2]);
if (!path.basename(root).startsWith('sesshuttle-ui-')) throw Error('Test root required');
const marker = JSON.parse(await fs.readFile(path.join(root, '.sesshuttle-test.json'), 'utf8'));
if (marker.format !== 1) throw Error('Test marker required');
const objects = new Map();
// After the first line (the connection), each request is reported on its own line.
const server = http.createServer(async (req, res) => {
  console.log(JSON.stringify({ method: req.method, url: req.url }));
  try {
    const url = new URL(req.url, 'http://localhost'),
      key = decodeURIComponent(url.pathname).split('/').slice(2).join('/');
    if (req.method === 'GET' && url.searchParams.has('list-type')) {
      res.setHeader('content-type', 'application/xml');
      return res.end(
        `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.keys()]
          .filter((k) => k.startsWith(url.searchParams.get('prefix') ?? ''))
          .map(
            (k) => `<Contents><Key>${k}</Key><Size>${objects.get(k).body.length}</Size></Contents>`,
          )
          .join('')}</ListBucketResult>`,
      );
    }
    if (req.method === 'PUT') {
      const old = objects.get(key);
      if (
        (req.headers['if-none-match'] === '*' && old) ||
        (req.headers['if-match'] && old?.etag !== req.headers['if-match'])
      ) {
        res.writeHead(412);
        return res.end();
      }
      let n = 0;
      const parts = [];
      for await (const p of req) {
        n += p.length;
        if (n > 64 * 1024 * 1024) throw Error('limit');
        parts.push(p);
      }
      const body = Buffer.concat(parts),
        etag = '"' + hash(body) + '"';
      objects.set(key, { body, etag });
      res.setHeader('ETag', etag);
      return res.end();
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader('ETag', object.etag);
    res.setHeader('Content-Length', object.body.length);
    res.end(object.body);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(
    JSON.stringify({
      endpoint: `http://127.0.0.1:${server.address().port}`,
      bucket: 'sesshuttle-ui',
      accessKeyId: 'synthetic-access',
      secretAccessKey: 'synthetic-secret',
    }),
  ),
);
