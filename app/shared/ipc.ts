// The single list of methods the renderer may call. `exclusive` methods change
// state; the main process never runs two of them at the same time.
// Both the preload allow-list and the main-process handler table derive from it.
export const IPC_METHODS = {
  init: {},
  saveConfig: { exclusive: true },
  detectPaths: {},
  destinationInfo: {},
  verifyRuntime: {},
  cancelRuntimeCheck: {},
  versionDetails: {},
  validateFolders: {},
  createWorkspace: {},
  restoreConnection: { exclusive: true },
  credentialHealth: {},
  retryCredentialSave: { exclusive: true },
  refresh: { exclusive: true },
  pickDirectory: {},
  pickBinary: {},
  pickImage: {},
  connect: { exclusive: true },
  disconnect: { exclusive: true },
  importRecovery: {},
  exportRecovery: {},
  preview: { exclusive: true },
  discardPlan: { exclusive: true },
  execute: { exclusive: true },
  cancel: {},
  downloadCopy: { exclusive: true },
  inspectTarget: {},
  keepLocalCopy: { exclusive: true },
  reviewRemoval: { exclusive: true },
  retryRemovalPlan: { exclusive: true },
  reviseRemovalPlan: { exclusive: true },
  executeRemoval: { exclusive: true },
  finishCloudRemoval: { exclusive: true },
  clearActivity: { exclusive: true },
  activityPage: {},
  backupBins: {},
  backups: {},
  reviewRestore: {},
  createBackup: { exclusive: true },
  deleteBackup: { exclusive: true },
  restore: { exclusive: true },
  projectInfo: {},
  continue: {},
  diagnostics: {},
} as const satisfies Record<string, { exclusive?: true }>;

export type IpcMethod = keyof typeof IPC_METHODS;
export const ipcMethodNames = Object.keys(IPC_METHODS) as IpcMethod[];
export const isIpcMethod = (name: unknown): name is IpcMethod =>
  typeof name === 'string' && Object.hasOwn(IPC_METHODS, name);
export const isExclusive = (name: IpcMethod) =>
  (IPC_METHODS[name] as { exclusive?: true }).exclusive === true;
