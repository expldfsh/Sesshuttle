import type { BrowserWindow } from 'electron';

export type RuntimeProof = { id: string; controller: AbortController; done: Promise<unknown> };

// Process-wide state shared by startup, the IPC handlers and the window.
export type Context = {
  testRoot?: string;
  rendererFile: string;
  state: any;
  engine: any;
  trash: any;
  removals: any;
  window: BrowserWindow | null;
  // Unlocked R2 credentials and the space key. Never written to disk in plain text.
  secrets: any;
  // A connection file read in this session, waiting for the user to join.
  recovery: any;
  activeProof: RuntimeProof | null;
  deletionActive: boolean;
  // Replacement images chosen through the native picker during this session.
  attachmentPicks: Set<string>;
};
