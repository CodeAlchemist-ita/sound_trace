// Finds the sentences the code passes to t(), msg() and plural(), by reading the source
// as text. Used by the i18n test (every sentence must have a translation) — not by the app.

const STRING = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\`((?:[^\`\\$]|\\.)*)\``;

const unescape = (s: string) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

function strings(source: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(pattern)) {
    for (let i = 1; i < m.length; i++) if (m[i] !== undefined) out.push(unescape(m[i]));
  }
  return out;
}

/** All translatable sentences in one source file. */
export function extractKeys(source: string): string[] {
  const keys = [
    // t('…') and msg('…'), also with the string on the next line.
    ...strings(source, new RegExp(String.raw`\b(?:t|msg)\(\s*(?:${STRING})`, 'g')),
    // plural(n, 'one', 'other'): two patterns, one per string, so the groups stay simple.
    ...strings(source, new RegExp(String.raw`\bplural\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*(?:${STRING})`, 'g')),
    ...strings(
      source,
      new RegExp(String.raw`\bplural\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*(?:${STRING})\s*,\s*(?:${STRING})`, 'g'),
    ),
  ];
  return [...new Set(keys)];
}

/** `{name}` placeholders of a sentence, sorted. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}
