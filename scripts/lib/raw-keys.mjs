/* global document */
// Visible text that looks like a message key or code instead of a translation:
// camelCase or snake_case words. Paths, ids, environment names, preformatted
// technical text (diagnostics, error details) are ignored.
export async function rawKeys(page) {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, 4);
    const parts = [];
    while (walker.nextNode())
      if (walker.currentNode.parentElement?.closest('[hidden],script,style,pre,.technical') == null)
        parts.push(walker.currentNode.textContent);
    for (const e of document.querySelectorAll('[aria-label],[placeholder],[title]'))
      parts.push(...['aria-label', 'placeholder', 'title'].map((a) => e.getAttribute(a) ?? ''));
    const text = parts.join('\n');
    const allowed = /^(CODEX_HOME|R2|sesshuttle|macOS|iPhone|sessions|state)$/;
    const found = new Set();
    for (const line of text.split('\n')) {
      if (/[/\\]/.test(line)) continue;
      for (const m of line.matchAll(/\b([a-z]+[A-Z][A-Za-z]*|[a-z]+_[a-z_]+)\b/g))
        if (!allowed.test(m[1])) found.add(m[1]);
    }
    return [...found];
  });
}
