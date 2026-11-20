const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The runtime is Electron's own program. Windows takes the icon in the title bar and
// the taskbar and the name in Task Manager from the program that owns the window, so
// both are replaced with the app's. Everything else in the file stays as it is.
async function brandWindowsRuntime(file, icon) {
  const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const copyright = (await fs.readFile('LICENSE', 'utf8')).match(/^Copyright .+$/m)?.[0] ?? '';
  const executable = NtExecutable.from(await fs.readFile(file));
  const resources = NtExecutableResource.from(executable);
  const info =
    Resource.VersionInfo.fromEntries(resources.entries)[0] ?? Resource.VersionInfo.createEmpty();
  const language = info.getAllLanguagesForStringValues()[0] ?? { lang: 0x0409, codepage: 1200 };
  const [major, minor, patch] = pkg.version.split(/[.+-]/).map((part) => Number(part) || 0);
  info.setFileVersion(major, minor, patch, 0);
  info.setProductVersion(major, minor, patch, 0);
  info.setStringValues(language, {
    CompanyName: pkg.author.name,
    FileDescription: 'Sesshuttle',
    FileVersion: pkg.version,
    InternalName: 'sesshuttle-runtime',
    LegalCopyright: copyright,
    OriginalFilename: 'sesshuttle-runtime.exe',
    ProductName: 'Sesshuttle',
    ProductVersion: pkg.version,
  });
  info.outputToResourceEntries(resources.entries);
  const icons = Data.IconFile.from(await fs.readFile(icon)).icons.map((item) => item.data);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  if (!groups.length) throw Error('The Windows runtime has no icon to replace');
  for (const group of groups)
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  resources.outputResource(executable);
  await fs.writeFile(file, Buffer.from(executable.generate()));
}
exports.brandWindowsRuntime = brandWindowsRuntime;

exports.default = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName === 'win32') {
    execFileSync(process.execPath, ['scripts/windows-launcher.mjs'], { stdio: 'inherit' });
    const runtime = path.join(appOutDir, 'sesshuttle-runtime.exe');
    await fs.rename(path.join(appOutDir, packager.appInfo.productFilename + '.exe'), runtime);
    await brandWindowsRuntime(runtime, 'dist/windows-build/icon.ico');
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
