// The plain text of an answer (without --json): the fields of an object one per line ("key: value",
// nested ones with dots), the items of a list separated by a blank line; and --fields, which keeps
// the fields named (dotted paths) of an object, or of each item of a list.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (Array.isArray(value)) return value.length ? value.map(scalar).join(', ') : '-';
  if (isObject(value)) return JSON.stringify(value);
  return String(value);
}

function lines(value: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (isObject(v) && Object.keys(v).length) out.push(...lines(v, name));
    else if (Array.isArray(v) && v.some(isObject)) v.forEach((item, i) => out.push(...(isObject(item) ? lines(item, `${name}[${i}]`) : [`${name}[${i}]: ${scalar(item)}`])));
    else out.push(`${name}: ${scalar(v)}`);
  }
  return out;
}

/** An answer as plain text. */
export function renderText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map((item) => (isObject(item) ? lines(item).join('\n') : scalar(item))).join('\n\n') : '(none)';
  if (isObject(value)) return lines(value).join('\n');
  return scalar(value);
}

function pick(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((v, key) => (isObject(v) ? v[key] : undefined), value);
}
function put(target: Record<string, unknown>, path: string, v: unknown) {
  const keys = path.split('.');
  let at = target;
  for (const key of keys.slice(0, -1)) at = (isObject(at[key]) ? at[key] : (at[key] = {})) as Record<string, unknown>;
  at[keys[keys.length - 1]] = v;
}

/** [value] restricted to [fields] (dotted paths): an object's, or each item's of a list. */
export function selectFields(value: unknown, fields: readonly string[] | undefined): unknown {
  if (!fields?.length) return value;
  if (Array.isArray(value)) return value.map((item) => selectFields(item, fields));
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const f of fields) { const v = pick(value, f); if (v !== undefined) put(out, f, v); }
  return out;
}
