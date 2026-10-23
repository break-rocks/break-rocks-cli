// The parser of the SDL of the contract into its compact form (scripts/gen-schema.mjs; test/api.test.ts).

/** The SDL in its compact form: { types: { Name: { k: 'o'|'i'|'e'|'u'|'s', f?: { field: [type, args?] }, v?: [values] } }, query, mutation }. */
export function parse(sdl) {
  const types = {};
  const lines = sdl.split('\n').map((l) => l.replace(/#.*$/, '').trimEnd());
  let current = null;
  const splitArgs = (s) => { const out = []; let depth = 0, start = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '[' || c === '(') depth++; else if (c === ']' || c === ')') depth--; else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; } } out.push(s.slice(start)); return out.map((a) => a.trim()).filter(Boolean); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if (!current) {
      if ((m = /^(type|input|enum|interface)\s+(\w+)[^{]*\{\s*$/.exec(line))) { current = { name: m[2], kind: { type: 'o', interface: 'o', input: 'i', enum: 'e' }[m[1]] }; types[m[2]] = current.kind === 'e' ? { k: 'e', v: [] } : { k: current.kind, f: {} }; continue; }
      if ((m = /^union\s+(\w+)[^=]*=\s*(.+)$/.exec(line))) { types[m[1]] = { k: 'u', v: m[2].split('|').map((s) => s.trim()) }; continue; }
      if ((m = /^scalar\s+(\w+)/.exec(line))) { types[m[1]] = { k: 's' }; continue; }
      continue;
    }
    if (line.startsWith('}')) { current = null; continue; }
    const t = types[current.name];
    if (t.k === 'e') { const v = line.split(/\s+/)[0]; if (/^\w+$/.test(v)) t.v.push(v); continue; }
    if ((m = /^(\w+)(?:\((.*)\))?\s*:\s*([\w[\]!]+)/.exec(line))) {
      const entry = [m[3]];
      if (m[2]) entry.push(Object.fromEntries(splitArgs(m[2]).map((a) => { const [n, ty] = a.split(':').map((x) => x.trim()); return [n, ty.split(/\s|=/)[0]]; })));
      t.f[m[1]] = entry;
    }
  }
  const { Query, Mutation, ...rest } = types;
  return { types: rest, query: Query.f, mutation: Mutation.f };
}

