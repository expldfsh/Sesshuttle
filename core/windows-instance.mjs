import net from 'node:net';
import { Fault, hash } from './util.mjs';

const leases = new Map();
// A named pipe is exclusive across processes and disappears even after a crash.
// The same process may already own the source while it prepares a folder move.
export async function reserveWindowsInstance(identity, errorCode) {
  let lease = leases.get(identity);
  if (!lease) {
    const server = net.createServer((client) => client.destroy());
    const ready = new Promise((resolve, reject) => {
      server.once('error', () => reject(new Fault(errorCode)));
      server.listen('\\\\.\\pipe\\Sesshuttle-' + hash(identity), resolve);
    });
    lease = { server, ready, refs: 0 };
    leases.set(identity, lease);
  }
  lease.refs++;
  try {
    await lease.ready;
  } catch (error) {
    leases.delete(identity);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lease.refs === 0) {
      leases.delete(identity);
      lease.server.close();
    }
  };
}
