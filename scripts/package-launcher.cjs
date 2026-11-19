const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
exports.default = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName === 'win32') {
    execFileSync(process.execPath, ['scripts/windows-launcher.mjs'], { stdio: 'inherit' });
    await fs.rename(
      path.join(appOutDir, packager.appInfo.productFilename + '.exe'),
      path.join(appOutDir, 'sesshuttle-runtime.exe'),
    );
    await fs.copyFile('dist/Sesshuttle.exe', path.join(appOutDir, 'Sesshuttle.exe'));
    await fs.copyFile(
      'dist/sesshuttle-start.cjs',
      path.join(appOutDir, 'resources/sesshuttle-start.cjs'),
    );
    return;
  }
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
