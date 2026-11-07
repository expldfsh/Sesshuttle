import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Fault, requireThat, id, LIMIT } from './util.mjs';
export class R2Store {
  constructor(config, { allowLocal = false } = {}) {
    let url;
    try {
      url = new URL(config.endpoint);
    } catch {
      throw new Fault('invalid_endpoint');
    }
    requireThat(
      allowLocal
        ? url.hostname === '127.0.0.1'
        : url.protocol === 'https:' &&
            /^[a-z0-9]+(?:\.[a-z]+)?\.r2\.cloudflarestorage\.com$/.test(url.hostname),
      'invalid_endpoint',
    );
    requireThat(
      !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.pathname === '/' || url.pathname === ''),
      'invalid_endpoint',
    );
    requireThat(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket), 'invalid_bucket');
    this.bucket = config.bucket;
    this.endpoint = url.origin;
    this.client = new S3Client({
      endpoint: url.origin,
      region: 'auto',
      forcePathStyle: true,
      maxAttempts: 2,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: new NodeHttpHandler({ connectionTimeout: 6000, requestTimeout: 30000 }),
    });
  }
  async call(command) {
    try {
      return await this.client.send(command);
    } catch (e) {
      if (e.$metadata?.httpStatusCode === 412 || e.$metadata?.httpStatusCode === 409)
        throw new Fault('concurrent_update');
      if (e.$metadata?.httpStatusCode === 403 || e.$metadata?.httpStatusCode === 401)
        throw new Fault('storage_permission');
      if (e.$metadata?.httpStatusCode === 404 || e.name === 'NoSuchKey') return null;
      throw new Fault('storage_unavailable');
    }
  }
  async get(key) {
    const r = await this.call(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r) return null;
    requireThat(r.ContentLength <= LIMIT, 'file_too_large');
    const parts = [];
    let n = 0;
    for await (const part of r.Body) {
      n += part.length;
      if (n > LIMIT) {
        r.Body.destroy();
        throw new Fault('file_too_large');
      }
      parts.push(part);
    }
    return { body: Buffer.concat(parts), etag: r.ETag };
  }
  async put(key, body, etag) {
    const r = await this.call(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        ...(etag === null ? { IfNoneMatch: '*' } : etag ? { IfMatch: etag } : {}),
      }),
    );
    requireThat(r, 'storage_unavailable');
    return r.ETag;
  }
  async remove(key) {
    await this.call(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  // ListObjectsV2 pagination. `entry` maps each listed object page by page; a
  // repeated cursor or more than `limit` objects stops the walk.
  async listObjects(prefix, limit, entry) {
    let cursor;
    const entries = [],
      seen = new Set();
    do {
      const r = await this.call(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: cursor,
        }),
      );
      requireThat(r, 'storage_unavailable');
      entries.push(...(r.Contents ?? []).map(entry));
      requireThat(entries.length <= limit, 'space_too_large');
      cursor = r.IsTruncated ? r.NextContinuationToken : null;
      requireThat(!r.IsTruncated || (cursor && !seen.has(cursor)), 'corrupt_data');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return entries;
  }
  inventory(prefix) {
    return this.listObjects(prefix, 200000, (x) => {
      requireThat(
        typeof x.Key === 'string' && Number.isSafeInteger(x.Size) && x.Size >= 0,
        'corrupt_data',
      );
      return { key: x.Key, bytes: x.Size };
    });
  }
  list(prefix) {
    return this.listObjects(prefix, 20000, (x) => x.Key);
  }
  async test() {
    await this.list('sesshuttle/probe/');
    const key = 'sesshuttle/probe/' + id();
    const data = Buffer.from(id());
    try {
      await this.put(key, data, null);
    } catch (e) {
      throw new Fault(e.code === 'storage_permission' ? 'storage_write_permission' : e.code);
    }
    const read = await this.get(key);
    requireThat(read?.body.equals(data), 'corrupt_data');
    await this.call(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return { read: true, write: true };
  }
}
