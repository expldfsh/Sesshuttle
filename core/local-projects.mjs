import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dbPaths, readProjects, tableColumns } from './catalog.mjs';
import { inside, requireThat } from './util.mjs';

// A project can exist before its first conversation.
export async function localProjects(home) {
  const {state} = await dbPaths(home);
  if (!state) return {supported: false, projects: []};
  await inside(home, state);
  const db = new DatabaseSync(state, {readOnly: true});
  try {
    const supported = tableColumns(db, 'projects').includes('name') && tableColumns(db, 'threads').includes('project_id');
    const projects = supported ? readProjects(db) : [];
    for (const project of projects) {
      project.folders = [];
      for (const root of project.roots.filter(p => typeof p === 'string' && path.isAbsolute(p))) {
        if ((await fs.stat(root).catch(() => null))?.isDirectory()) project.folders.push(root);
      }
      delete project.backing;
    }
    return {supported, projects};
  } finally { db.close(); }
}
export async function checkLocalProject(home, projectId, runtime) {
  if (!projectId) return;
  requireThat(runtime.startsWith('0.166.0'), 'project_assignment_unsupported');
  const catalog = await localProjects(home);
  const match=catalog.projects.find(p=>p.id===projectId);
  requireThat(catalog.supported && match, 'destination_project_missing');
  return match.name;
}
