// Folder names for new working folders keep letters and digits in every script.
export function workspaceFolderName(name, projectId) {
  const label = String(name || 'Project').replace(/[^\p{L}\p{N} _-]/gu, '_').slice(0, 70);
  return label + '-' + String(projectId).slice(0, 8);
}
