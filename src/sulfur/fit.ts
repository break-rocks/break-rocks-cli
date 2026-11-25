// A document of the CLI (API v2, the talc schema) fitted to what the new backend serves (native-sulfur, D-612: the talc
// operations under their names, without the fields of the features not ported yet; server docs/talc-deviations.md), as the
// web app's seam does (frontends/react src/sulfur/talc/fit.ts), with the CLI's own small reader of documents (no runtime
// dependency, D-91):
// - a root field the server does not serve: NOT_ON_NEW_BACKEND (the operation named);
// - a field (or an inline fragment) the server's type lacks: left out, answered null afterwards ([] for a talc list);
// - an argument the server does not take: left out when the command gave it no value, else NOT_ON_NEW_BACKEND (never sent
//   without it: an image, a place…); an argument the server requires and the document lacks: NOT_ON_NEW_BACKEND;
// - a variable declared with the talc type: declared with the server's type of the argument it goes to (an enum the
//   server takes as a String, an ID made optional…); a variable no longer used: dropped;
// - the fields of an input variable the server's input type lacks: left out when empty, refused when filled.
import { tokenize, type Token } from '../api/degrade.js';
import { CONTRACT, typeRef } from '../api/graphql.js';
import type { Sdl } from '../api/sdl.js';
import { cliRefusal, type CliError } from '../errors.js';
import { SERVER } from './schema.generated.js';

/** An operation (or one of its arguments, fields) the new backend does not serve. */
export const notServed = (what: string, detail?: string): CliError => cliRefusal('NOT_ON_NEW_BACKEND', `${what} is not served by the new backend (native-sulfur)${detail ? `: ${detail}` : ''}: --backend legacy, or wait for its port`, { operation: what, backend: 'sulfur' });

type Arg = { name: string; start: number; end: number; variable?: string; inner: string[]; empty: boolean };
type Field = { kind: 'field'; key: string; name: string; start: number; end: number; args: Arg[]; argsStart?: number; argsEnd?: number; selection?: Selection };
type Inline = { kind: 'inline'; on?: string; spread?: string; start: number; end: number; selection?: Selection };
type Selection = { start: number; end: number; items: (Field | Inline)[] };
type VarDef = { name: string; start: number; end: number; typeStart: number; typeEnd: number; type: string };
export type Operation = { kind: 'query' | 'mutation' | 'subscription'; name?: string; vars: VarDef[]; varsStart?: number; varsEnd?: number; selection: Selection };

/** The operations of [doc] (no named fragments in the CLI's documents: refused if any). */
export function parseOperations(doc: string): Operation[] {
  const tokens = tokenize(doc);
  let at = 0;
  const peek = (text?: string): Token | undefined => (text === undefined ? tokens[at] : tokens[at]?.text === text ? tokens[at] : undefined);
  const next = () => { const t = tokens[at++]; if (!t) throw new Error('Unexpected end of the document'); return t; };
  const expect = (text: string) => { const t = next(); if (t.text !== text) throw new Error(`Expected ${text}, found ${t.text}`); return t; };
  /** A value (a variable, a literal, a list, an object): its last token. */
  const value = (): { last: Token; variable?: string; inner: string[]; empty: boolean } => {
    const first = next();
    if (first.text === '$') { const name = next(); return { last: name, variable: name.text, inner: [], empty: false }; }
    if (first.text === '[' || first.text === '{') {
      const close = first.text === '[' ? ']' : '}';
      let depth = 1, last = first, count = 0;
      const inner: string[] = [];
      while (depth > 0) {
        last = next(); count++;
        if (last.text === '$') inner.push(tokens[at].text);
        else if (last.text === first.text) depth++; else if (last.text === close) depth--;
      }
      return { last, inner, empty: count === 1 };
    }
    return { last: first, inner: [], empty: first.text === 'null' || first.text === 'false' || first.text === '""' };
  };
  const directives = () => { while (peek('@')) { next(); next(); if (peek('(')) { next(); while (!peek(')')) { next(); expect(':'); value(); } next(); } } };
  const args = (): { list: Arg[]; start: number; end: number } => {
    const open = expect('(');
    const list: Arg[] = [];
    while (!peek(')')) {
      const name = next();
      expect(':');
      const v = value();
      list.push({ name: name.text, start: name.start, end: v.last.end, ...(v.variable ? { variable: v.variable } : {}), inner: v.inner, empty: v.empty });
    }
    return { list, start: open.start, end: next().end };
  };
  const selectionSet = (): Selection => {
    const open = expect('{');
    const items: (Field | Inline)[] = [];
    while (!peek('}')) {
      const first = next();
      if (first.text === '...') {
        if (peek('on')) {
          next();
          const on = next().text;
          directives();
          const selection = selectionSet();
          items.push({ kind: 'inline', on, selection, start: first.start, end: selection.end });
        } else if (peek('{') || peek('@')) {
          directives();
          const selection = selectionSet();
          items.push({ kind: 'inline', selection, start: first.start, end: selection.end });
        } else throw new Error('Named fragments are not read here');
        continue;
      }
      let name = first.text;
      const key = name;
      if (peek(':')) { next(); name = next().text; }
      const a = peek('(') ? args() : undefined;
      directives();
      const selection = peek('{') ? selectionSet() : undefined;
      items.push({ kind: 'field', key, name, start: first.start, end: selection?.end ?? tokens[at - 1].end, args: a?.list ?? [], ...(a ? { argsStart: a.start, argsEnd: a.end } : {}), ...(selection ? { selection } : {}) });
    }
    return { start: open.start, end: expect('}').end, items };
  };
  const ops: Operation[] = [];
  while (at < tokens.length) {
    if (peek('{')) { ops.push({ kind: 'query', vars: [], selection: selectionSet() }); continue; }
    const head = next().text;
    if (head === 'fragment') throw new Error('Named fragments are not read here');
    if (head !== 'query' && head !== 'mutation' && head !== 'subscription') throw new Error(`Unexpected ${head}`);
    const name = peek()?.kind === 'name' ? next().text : undefined;
    const vars: VarDef[] = [];
    let varsStart: number | undefined, varsEnd: number | undefined;
    if (peek('(')) {
      varsStart = next().start;
      while (!peek(')')) {
        const dollar = expect('$');
        const v = next().text;
        expect(':');
        const typeStart = tokens[at].start;
        let depth = 0, last = tokens[at];
        while (at < tokens.length) {
          const t = tokens[at];
          if (depth === 0 && (t.text === ')' || t.text === '$' || t.text === '=' || t.text === '@')) break;
          if (t.text === '[') depth++;
          if (t.text === ']') depth--;
          last = t; at++;
        }
        const typeEnd = last.end;
        let end = typeEnd;
        if (peek('=')) { next(); end = value().last.end; }
        directives();
        vars.push({ name: v, start: dollar.start, end, typeStart, typeEnd, type: doc.slice(typeStart, typeEnd).replace(/\s+/g, '') });
      }
      varsEnd = next().end;
    }
    directives();
    ops.push({ kind: head, ...(name ? { name } : {}), vars, ...(varsStart !== undefined ? { varsStart, varsEnd } : {}), selection: selectionSet() });
  }
  return ops;
}

/** A field left out, where its answer is: its keys from the top of the data, and whether talc answers a list there. */
export type LeftOut = { path: string[]; list: boolean };
export type Fitted = { document: string; variables: Record<string, unknown>; left: LeftOut[]; roots: { key: string; name: string; kind: Operation['kind'] }[] };

const emptyValue = (v: unknown) => v === undefined || v === null || v === false || v === '' || (Array.isArray(v) && !v.length);
const rootOf = (s: Sdl, kind: Operation['kind']) => (kind === 'mutation' ? s.mutation : kind === 'query' ? s.query : undefined);
const fieldOf = (s: Sdl, type: string, name: string) => (type === 'Query' ? s.query[name] : type === 'Mutation' ? s.mutation[name] : s.types[type]?.f?.[name]);
const isLeaf = (s: Sdl, type: string) => { const k = s.types[type]?.k; return !k || k === 'e' || k === 's'; };

/**
 * [doc] as the new backend serves it. Throws NOT_ON_NEW_BACKEND for a root field it does not serve, an argument it does
 * not take given a value, an argument it requires missing, or an input field it lacks given a value.
 */
export function fitDocument(doc: string, variables: Record<string, unknown>, server: Sdl = SERVER, talc: Sdl = CONTRACT): Fitted {
  const ops = parseOperations(doc);
  const cuts: { start: number; end: number; text: string }[] = [];
  const left: LeftOut[] = [];
  const used = new Set<string>();
  /** The server's type of each variable, from the argument it goes to. */
  const varType = new Map<string, string>();
  const roots: Fitted['roots'] = [];

  const fitArgs = (f: Field, args: Record<string, string>, where: string) => {
    let kept = 0;
    const argCuts: { start: number; end: number; text: string }[] = [];
    for (const a of f.args) {
      const type = args[a.name];
      if (!type) {
        const empty = a.variable ? emptyValue(variables[a.variable]) : a.empty && !a.inner.length;
        if (!empty) throw notServed(`${where}(${a.name})`, 'the argument is not taken');
        argCuts.push({ start: a.start, end: a.end, text: '' });
        continue;
      }
      kept++;
      for (const v of a.inner) used.add(v);
      if (a.variable) { used.add(a.variable); if (!varType.has(a.variable)) varType.set(a.variable, type); }
    }
    for (const [name, type] of Object.entries(args)) {
      if (type.endsWith('!') && !f.args.some((a) => a.name === name)) throw notServed(`${where}(${name})`, 'the backend requires an argument the CLI does not give');
    }
    if (argCuts.length && !kept && f.argsStart !== undefined) cuts.push({ start: f.argsStart, end: f.argsEnd!, text: '' });
    else cuts.push(...argCuts);
  };
  // Variables used in arguments of fields left out are not counted as used (only kept fields add to `used`).
  const fitSelection = (sel: Selection, serverType: string, talcType: string | undefined, path: string[]) => {
    let kept = 0;
    for (const item of sel.items) {
      if (item.kind === 'inline') {
        const on = item.on ?? serverType;
        if (!server.types[on] && on !== serverType) { cuts.push({ start: item.start, end: item.end, text: '' }); continue; }
        kept++;
        if (item.selection) fitSelection(item.selection, on, item.on ?? talcType, path);
        continue;
      }
      if (item.name.startsWith('__')) { kept++; continue; }
      const def = fieldOf(server, serverType, item.name);
      const talcDef = talcType ? fieldOf(talc, talcType, item.name) : undefined;
      const inner = def ? typeRef(def[0]).name : '';
      if (!def || (isLeaf(server, inner) === !!item.selection)) {
        cuts.push({ start: item.start, end: item.end, text: '' });
        left.push({ path: [...path, item.key], list: talcDef ? typeRef(talcDef[0]).list : false });
        continue;
      }
      kept++;
      fitArgs(item, def[1] ?? {}, `${serverType}.${item.name}`);
      if (item.selection) fitSelection(item.selection, inner, talcDef ? typeRef(talcDef[0]).name : undefined, [...path, item.key]);
    }
    if (!kept) cuts.push({ start: sel.start, end: sel.end, text: '{ __typename }' });
  };

  for (const op of ops) {
    const root = rootOf(server, op.kind);
    if (!root) throw notServed(`${op.kind} ${op.name ?? ''}`.trim(), 'no subscriptions');
    for (const item of op.selection.items) {
      if (item.kind !== 'field') throw notServed('a fragment at the root of an operation');
      if (item.name === '__typename') continue;
      const def = root[item.name];
      if (!def) throw notServed(item.name);
      roots.push({ key: item.key, name: item.name, kind: op.kind });
      fitArgs(item, def[1] ?? {}, item.name);
      const inner = typeRef(def[0]).name;
      const talcDef = rootOf(talc, op.kind)?.[item.name];
      if (item.selection && !isLeaf(server, inner)) fitSelection(item.selection, inner, talcDef ? typeRef(talcDef[0]).name : undefined, [item.key]);
      else if (item.selection) cuts.push({ start: item.selection.start, end: item.selection.end, text: '' });
      else if (!isLeaf(server, inner)) throw notServed(item.name, `it answers a ${inner} where the CLI expects a value`);
    }
    // The variables: the server's type of their argument, the unused ones dropped.
    if (op.varsStart !== undefined) {
      const keptVars = op.vars.filter((v) => used.has(v.name));
      if (!keptVars.length) cuts.push({ start: op.varsStart, end: op.varsEnd!, text: '' });
      else for (const v of op.vars) {
        if (!used.has(v.name)) cuts.push({ start: v.start, end: v.end, text: '' });
        else if (varType.get(v.name) && varType.get(v.name) !== v.type) cuts.push({ start: v.typeStart, end: v.typeEnd, text: varType.get(v.name)! });
      }
    }
  }

  // Cuts applied in order; a cut inside an earlier one is moot.
  const ordered = cuts.sort((a, b) => a.start - b.start || b.end - a.end);
  let document = '';
  let from = 0;
  for (const cut of ordered) {
    if (cut.start < from) continue;
    document += doc.slice(from, cut.start) + cut.text;
    from = cut.end;
    // A list item removed takes its comma with it (commas are insignificant in GraphQL: only tidier).
    if (!cut.text) { const comma = /^\s*,/.exec(doc.slice(from)); if (comma) from += comma[0].length; }
  }
  document += doc.slice(from);

  const fitInput = (value: unknown, type: string, path: string): unknown => {
    const t = server.types[type];
    if (!t || t.k !== 'i' || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((x) => fitInput(x, type, path));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
      const f = t.f?.[k];
      if (f) { out[k] = fitInput(x, typeRef(f[0]).name, `${path}.${k}`); continue; }
      if (!emptyValue(x)) throw notServed(`${path}.${k}`, 'the field is not taken');
    }
    return out;
  };
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(variables)) if (used.has(k)) kept[k] = varType.has(k) ? fitInput(v, typeRef(varType.get(k)!).name, k) : v;
  return { document, variables: kept, left, roots };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** [data] with every field left out answered: null, or [] where talc answers a list. */
export function fillLeftOut<T>(data: T, left: readonly LeftOut[]): T {
  const place = (value: unknown, path: readonly string[], list: boolean): void => {
    if (Array.isArray(value)) { for (const v of value) place(v, path, list); return; }
    if (!isObject(value)) return;
    if (path.length === 1) { if (!(path[0] in value)) value[path[0]] = list ? [] : null; return; }
    place(value[path[0]], path.slice(1), list);
  };
  for (const l of left) place(data, l.path, l.list);
  return data;
}
