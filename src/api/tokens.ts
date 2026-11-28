// The tokens of a GraphQL document (names, punctuators, strings and numbers) with their offsets: src/sulfur/fit.ts reads the
// documents of the commands with them.

export type Token = { kind: 'name' | 'punct' | 'value'; text: string; start: number; end: number };

/** The tokens of a document (names, punctuators, strings and numbers), with their offsets. */
export function tokenize(doc: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < doc.length) {
    const c = doc[i];
    if (/[\s,﻿]/.test(c)) { i++; continue; }
    if (c === '#') { while (i < doc.length && doc[i] !== '\n') i++; continue; }
    const start = i;
    if (doc.startsWith('...', i)) { tokens.push({ kind: 'punct', text: '...', start, end: i += 3 }); continue; }
    if ('{}()[]:$!=@|&'.includes(c)) { tokens.push({ kind: 'punct', text: c, start, end: ++i }); continue; }
    if (doc.startsWith('"""', i)) {
      i += 3;
      while (i < doc.length && !doc.startsWith('"""', i)) i += doc.startsWith('\\"""', i) ? 4 : 1;
      tokens.push({ kind: 'value', text: doc.slice(start, i + 3), start, end: i += 3 });
      continue;
    }
    if (c === '"') {
      i++;
      while (i < doc.length && doc[i] !== '"') i += doc[i] === '\\' ? 2 : 1;
      tokens.push({ kind: 'value', text: doc.slice(start, i + 1), start, end: ++i });
      continue;
    }
    const m = /^[_A-Za-z][_0-9A-Za-z]*|^-?[0-9][0-9.eE+-]*/.exec(doc.slice(i));
    if (!m) throw new Error(`Unexpected character ${c} at ${i}`);
    i += m[0].length;
    tokens.push({ kind: /^[_A-Za-z]/.test(m[0]) ? 'name' : 'value', text: m[0], start, end: i });
  }
  return tokens;
}

