// A certificate for a loopback HTTPS server, made for one test run and never saved in
// the repository. Tests that need it are skipped where no openssl program is installed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function temporaryCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesshuttle-tls-'));
  try {
    const key = path.join(dir, 'key.pem'),
      cert = path.join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        ...['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'],
        ...['-nodes', '-days', '2', '-subj', '/CN=localhost', '-keyout', key, '-out', cert],
        ...['-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      ],
      { stdio: 'ignore' },
    );
    return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
