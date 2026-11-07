// Shared readers for Codex history items found in rollouts and native databases.
export const MESSAGE_LIMIT = 12000;

const ROLES = new Map([
  ['usermessage', 'user'],
  ['agentmessage', 'assistant'],
  ['commandexecution', 'tool'],
]);

// A user, assistant or command item; null for anything else.
export function messageFromItem(item) {
  const role = ROLES.get(typeof item?.type === 'string' ? item.type.toLowerCase() : '');
  if (!role) return null;
  const text =
    item.text ??
    item.aggregatedOutput ??
    item.aggregated_output ??
    item.content?.map((x) => x.text ?? '').join('\n') ??
    '';
  return { role, text: String(text).slice(0, MESSAGE_LIMIT) };
}

// The rollout event form: { type: 'user_message' | 'agent_message', message }.
export function messageFromEvent(payload) {
  const role =
    payload?.type === 'user_message'
      ? 'user'
      : payload?.type === 'agent_message'
        ? 'assistant'
        : null;
  return role ? { role, text: String(payload.message ?? '').slice(0, MESSAGE_LIMIT) } : null;
}

// Depth-first over every object and array, parents before children. A callback
// may rewrite a node in place; its new children are visited afterwards.
export function walkObjects(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  for (const child of Object.values(value)) if (typeof child === 'object') walkObjects(child, fn);
}

export const isLocalImage = (node) => node?.type === 'localImage' || node?.type === 'local_image';

// Calls fn for every explicit local image reference. Returns true when any call did.
export function visitLocalImages(value, fn) {
  let changed = false;
  walkObjects(value, (node) => {
    if (isLocalImage(node) && fn(node)) changed = true;
  });
  return changed;
}
