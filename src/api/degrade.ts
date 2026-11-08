// A backend behind this CLI (its API pinned on an older minor version of the specs): AppSync refuses a
// document that selects a field it does not serve yet ("Validation error of type FieldUndefined: Field
// 'x' in type 'Y' is undefined"), before running anything. The document is then sent again once without
// those fields (the degraded selection, found by the types of the contract), and the answer carries
// them as null. A small reader of GraphQL documents: no runtime dependency (D-91).
import { CONTRACT, typeRef } from './graphql.js';

/** A field the backend does not serve: "Y.x". */
export type Unserved = { type: string; field: string };

const FIELD_UNDEFINED = /Validation error of type FieldUndefined: Field '([_A-Za-z][_0-9A-Za-z]*)' in type '([_A-Za-z][_0-9A-Za-z]*)' is undefined/;

/**
 * The fields refused by the backend when every error of an answer is a FieldUndefined validation error
 * (on a type other than Query and Mutation: an operation not served is not degraded); undefined otherwise.
 */
export function unservedFields(errors: readonly { message?: string }[] | undefined): Unserved[] | undefined {
  if (!errors?.length) return undefined;
  const found: Unserved[] = [];
  for (const error of errors) {
    const m = FIELD_UNDEFINED.exec(error.message ?? '');
    if (!m || m[2] === 'Query' || m[2] === 'Mutation' || m[2] === 'Subscription') return undefined;
    if (!found.some((u) => u.type === m[2] && u.field === m[1])) found.push({ type: m[2], field: m[1] });
  }
  return found;
}

type Token = { kind: 'name' | 'punct' | 'value'; text: string; start: number; end: number };

/** The tokens of a document (names, punctuators, strings and numbers), with their offsets. */
function tokenize(doc: string): Token[] {
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

type Field = { key: string; name: string; start: number; end: number; selection?: Selection };
type Fragment = { on?: string; spread?: string; selection?: Selection; start: number; end: number };
type Selection = { start: number; end: number; items: (Field | Fragment)[] };
type Parsed = { operations: { kind: string; selection: Selection }[]; fragments: Map<string, { on: string; selection: Selection }> };

/** The operations and the fragments of a document, as nested selections with their offsets. */
function parse(doc: string): Parsed {
  const tokens = tokenize(doc);
  let at = 0;
  const peek = (text?: string) => (text === undefined ? tokens[at] : tokens[at]?.text === text ? tokens[at] : undefined);
  const next = () => { const t = tokens[at++]; if (!t) throw new Error('Unexpected end of the document'); return t; };
  const expect = (text: string) => { const t = next(); if (t.text !== text) throw new Error(`Expected ${text}, found ${t.text}`); return t; };
  const skipBalanced = (open: string, close: string) => {
    expect(open);
    for (let depth = 1; depth > 0;) { const t = next(); if (t.kind === 'punct' && t.text === open) depth++; else if (t.kind === 'punct' && t.text === close) depth--; }
  };
  const directives = () => { while (peek('@')) { next(); next(); if (peek('(')) skipBalanced('(', ')'); } };
  const selectionSet = (): Selection => {
    const open = expect('{');
    const items: (Field | Fragment)[] = [];
    while (!peek('}')) {
      const first = next();
      if (first.text === '...') {
        if (peek('on')) {
          next();
          const on = next().text;
          directives();
          const selection = selectionSet();
          items.push({ on, selection, start: first.start, end: selection.end });
        } else if (peek('{') || peek('@')) {
          directives();
          const selection = selectionSet();
          items.push({ selection, start: first.start, end: selection.end });
        } else {
          const name = next();
          directives();
          items.push({ spread: name.text, start: first.start, end: tokens[at - 1].end });
        }
        continue;
      }
      let name = first.text;
      const key = name;
      if (peek(':')) { next(); name = next().text; }
      if (peek('(')) skipBalanced('(', ')');
      directives();
      const selection = peek('{') ? selectionSet() : undefined;
      items.push({ key, name, start: first.start, end: selection?.end ?? tokens[at - 1].end, selection });
    }
    return { start: open.start, end: expect('}').end, items };
  };
  const parsed: Parsed = { operations: [], fragments: new Map() };
  while (at < tokens.length) {
    if (peek('{')) { parsed.operations.push({ kind: 'query', selection: selectionSet() }); continue; }
    const head = next().text;
    if (head === 'fragment') {
      const name = next().text;
      expect('on');
      const on = next().text;
      directives();
      parsed.fragments.set(name, { on, selection: selectionSet() });
      continue;
    }
    if (peek()?.kind === 'name') next();
    if (peek('(')) skipBalanced('(', ')');
    directives();
    parsed.operations.push({ kind: head, selection: selectionSet() });
  }
  return parsed;
}

/** A field removed, where its answer is: the keys from the top of the data, and the type that holds it. */
export type Removed = { path: string[]; type: string; field: string };
export type Degraded = { document: string; removed: Removed[] };

const isField = (item: Field | Fragment): item is Field => 'key' in item;

/**
 * The document [doc] without the fields [unserved] (found by the types of the contract, aliases and
 * fragments included); a selection left empty keeps __typename. Undefined when nothing could be removed
 * or the document cannot be read.
 */
export function degrade(doc: string, unserved: readonly Unserved[]): Degraded | undefined {
  let parsed: Parsed;
  try { parsed = parse(doc); } catch { return undefined; }
  const cuts = new Map<number, { start: number; end: number; text: string }>();
  const removed: Removed[] = [];
  const isUnserved = (type: string, field: string) => unserved.some((u) => u.type === type && u.field === field);
  const fieldType = (type: string, field: string): string | undefined => {
    const raw = (type === 'Query' ? CONTRACT.query[field] : type === 'Mutation' ? CONTRACT.mutation[field] : CONTRACT.types[type]?.f?.[field])?.[0];
    return raw ? typeRef(raw).name : undefined;
  };
  const visit = (selection: Selection, type: string | undefined, path: string[], seen: Set<string>) => {
    let kept = 0;
    for (const item of selection.items) {
      if (isField(item)) {
        if (type && isUnserved(type, item.name)) {
          cuts.set(item.start, { start: item.start, end: item.end, text: '' });
          if (!removed.some((r) => r.path.join('.') === [...path, item.key].join('.') && r.type === type)) removed.push({ path: [...path, item.key], type, field: item.name });
          continue;
        }
        kept++;
        if (item.selection) visit(item.selection, type ? fieldType(type, item.name) : undefined, [...path, item.key], seen);
      } else if (item.spread) {
        kept++;
        const fragment = parsed.fragments.get(item.spread);
        if (fragment && !seen.has(item.spread)) visit(fragment.selection, fragment.on, path, new Set([...seen, item.spread]));
      } else if (item.selection) {
        kept++;
        visit(item.selection, item.on ?? type, path, seen);
      }
    }
    if (!kept) cuts.set(selection.start, { start: selection.start, end: selection.end, text: '{ __typename }' });
  };
  for (const op of parsed.operations) visit(op.selection, op.kind === 'mutation' ? 'Mutation' : op.kind === 'query' ? 'Query' : undefined, [], new Set());
  if (!removed.length) return undefined;
  // An emptied selection is replaced whole: the cuts inside it are then moot.
  const ordered = [...cuts.values()].sort((a, b) => a.start - b.start);
  let document = '';
  let from = 0;
  for (const cut of ordered) {
    if (cut.start < from) continue;
    document += doc.slice(from, cut.start) + cut.text;
    from = cut.end;
  }
  document += doc.slice(from);
  return { document, removed };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** [data] with every removed field set to null where its object is (in lists too; an object of another __typename left alone). */
export function nullRemoved<T>(data: T, removed: readonly Removed[]): T {
  const place = (value: unknown, path: readonly string[], r: Removed): void => {
    if (Array.isArray(value)) { for (const v of value) place(v, path, r); return; }
    if (!isObject(value)) return;
    if (path.length === 1) {
      if (!(path[0] in value) && (typeof value.__typename !== 'string' || value.__typename === r.type)) value[path[0]] = null;
      return;
    }
    place(value[path[0]], path.slice(1), r);
  };
  for (const r of removed) place(data, r.path, r);
  return data;
}
