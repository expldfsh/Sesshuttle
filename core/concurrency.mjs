// Calls fn for every item with at most `limit` calls in flight. Results keep the
// input order. After the first failure no new call starts; calls already running
// finish, then that first failure is thrown.
export async function mapLimit(items, limit, fn) {
  const list = [...items];
  const results = new Array(list.length);
  let next = 0;
  let failure = null;
  async function worker() {
    while (!failure && next < list.length) {
      const index = next++;
      try {
        results[index] = await fn(list[index], index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failure) throw failure.error;
  return results;
}
