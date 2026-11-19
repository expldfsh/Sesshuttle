const fs = require('node:fs/promises');
const path = require('node:path');
exports.default = async ({ appOutDir, electronPlatformName }) => {
  if (!['darwin', 'linux'].includes(electronPlatformName)) return;
  const mac = electronPlatformName === 'darwin';
  const contents = path.join(appOutDir, 'sesshuttle.app', 'Contents');
  const bin = mac ? path.join(contents, 'MacOS') : appOutDir;
  const resources = mac ? path.join(contents, 'Resources') : path.join(appOutDir, 'resources');
  const entry = path.join(bin, 'sesshuttle');
  await fs.rename(entry, path.join(bin, 'sesshuttle-runtime'));
  await fs.copyFile(mac ? 'dist/macos-launcher' : 'app/launcher/linux.sh', entry);
  await fs.chmod(entry, 0o755);
  await fs.copyFile('dist/sesshuttle-start.cjs', path.join(resources, 'sesshuttle-start.cjs'));
};
