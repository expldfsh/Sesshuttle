// Paths as the interface accepts and shows them. No file is touched here, so the
// interface can use this module too.

// A path copied with "Copy as path" on Windows, or from a shell, arrives in quotes.
// No absolute path begins with a quote, so one surrounding pair is dropped.
export const unquoted = (value) =>
  typeof value === 'string' && /^"[^"]*"$|^'[^']*'$/.test(value) ? value.slice(1, -1) : value;

// A folder joined with a path below it, in the notation the folder already uses.
export function joinShown(folder, relative) {
  const separator = folder.includes('\\') ? '\\' : '/';
  return (
    folder + (folder.endsWith(separator) ? '' : separator) + relative.replaceAll('/', separator)
  );
}
