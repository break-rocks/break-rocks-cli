// The subset of JSON Schema (draft 2020-12) that the schemas of the design system use (design-lib/schemas/*.schema.json)
// and the experience template of the specs (contracts/experiences/definition.schema.json): boolean schemas, local $ref
// ("#/$defs/…"), type, enum, const, pattern (Unicode), the bounds of numbers, strings and arrays, uniqueItems, items,
// properties, required, additionalProperties, propertyNames, minProperties, maxProperties, anyOf, allOf, not,
// if/then/else, and the annotation "deprecated" (each value read through a deprecated schema is listed). Without a
// dependency (D-91).
type Schema = boolean | Record<string, unknown>;
export type SchemaProblem = { path: string; keyword: string; message: string };
export type SchemaResult = { problems: SchemaProblem[]; deprecated: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const matchesType = (t: string, v: unknown) => (t === 'number' ? typeof v === 'number' : typeOf(v) === t);
const dotted = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);
/** A JSON pointer (RFC 6901): "/challenge/target/atLeast", "/parameters/0/key"; "" for the whole document. */
const pointer = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
export type ValidateOptions = {
  /** The paths as JSON pointers ("/title/en") instead of "title.en". */
  pointer?: boolean;
  /** Called with each value and the schema it is read through (its $ref resolved): checks of its own (the visible characters). */
  onValue?: (path: string, value: unknown, schema: Record<string, unknown>) => void;
};

/** [value] checked against [root]: the problems (path, keyword, message) and the paths read through a deprecated schema. */
export function validateJsonSchema(root: Record<string, unknown>, value: unknown, options: ValidateOptions = {}): SchemaResult {
  const at = options.pointer ? pointer : dotted;
  const resolve = (s: Schema): Schema => {
    let schema = s;
    for (let i = 0; i < 20 && isObject(schema) && typeof schema.$ref === 'string'; i++) {
      const ref = schema.$ref as string;
      if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
      const target = ref.slice(2).split('/').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), root) as Schema;
      const { $ref: _r, ...rest } = schema;
      void _r;
      schema = isObject(target) ? { ...target, ...rest } : target;
    }
    return schema;
  };
  const visit = (s: Schema, v: unknown, path: string, out: SchemaResult): void => {
    const schema = resolve(s);
    if (schema === true) return;
    if (schema === false) { out.problems.push({ path, keyword: 'false', message: 'is not allowed' }); return; }
    if (schema.deprecated === true) out.deprecated.push(path);
    options.onValue?.(path, v, schema);
    const fail = (keyword: string, message: string) => out.problems.push({ path, keyword, message });
    if (Array.isArray(schema.allOf)) for (const x of schema.allOf) visit(x as Schema, v, path, out);
    if (schema.not !== undefined) {
      const test: SchemaResult = { problems: [], deprecated: [] };
      visit(schema.not as Schema, v, path, test);
      if (!test.problems.length) {
        const not = resolve(schema.not as Schema);
        const values = isObject(not) ? (Array.isArray(not.enum) ? not.enum : not.const !== undefined ? [not.const] : undefined) : undefined;
        fail('not', values ? `must not be ${values.map((e) => JSON.stringify(e)).join(' nor ')}` : 'is not allowed');
      }
    }
    if (Array.isArray(schema.anyOf)) {
      const tries = schema.anyOf.map((x) => { const r: SchemaResult = { problems: [], deprecated: [] }; visit(x as Schema, v, path, r); return r; });
      const ok = tries.find((r) => !r.problems.length);
      if (ok) out.deprecated.push(...ok.deprecated);
      else out.problems.push(...(tries.sort((a, b) => a.problems.length - b.problems.length)[0]?.problems ?? [{ path, keyword: 'anyOf', message: 'matches none of the allowed forms' }]));
    }
    if (schema.if !== undefined) {
      const test: SchemaResult = { problems: [], deprecated: [] };
      visit(schema.if as Schema, v, path, test);
      const branch = test.problems.length ? schema.else : schema.then;
      if (branch !== undefined) visit(branch as Schema, v, path, out);
    }
    const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string];
    if (types.length && !types.some((t) => matchesType(t, v))) { fail('type', `must be ${types.join(' or ')}`); return; }
    if (schema.const !== undefined && JSON.stringify(v) !== JSON.stringify(schema.const)) fail('const', `must be ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) fail('enum', `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (typeof v === 'string') {
      const length = [...v].length;
      if (typeof schema.minLength === 'number' && length < schema.minLength) fail('minLength', `must have at least ${schema.minLength} characters`);
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail('maxLength', `must have at most ${schema.maxLength} characters`);
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(v)) fail('pattern', `must match ${schema.pattern}`);
    }
    if (typeof v === 'number') {
      if (typeof schema.minimum === 'number' && v < schema.minimum) fail('minimum', `must be at least ${schema.minimum}`);
      if (typeof schema.maximum === 'number' && v > schema.maximum) fail('maximum', `must be at most ${schema.maximum}`);
    }
    if (Array.isArray(v)) {
      if (typeof schema.minItems === 'number' && v.length < schema.minItems) fail('minItems', `must have at least ${schema.minItems} items`);
      if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) fail('maxItems', `must have at most ${schema.maxItems} items`);
      if (schema.uniqueItems === true && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) fail('uniqueItems', 'must not hold the same item twice');
      if (schema.items !== undefined) v.forEach((item, i) => visit(schema.items as Schema, item, at(path, i), out));
    }
    if (isObject(v)) {
      for (const key of (schema.required as string[] | undefined) ?? []) if (v[key] === undefined) out.problems.push({ path: at(path, key), keyword: 'required', message: 'is required' });
      const count = Object.values(v).filter((x) => x !== undefined).length;
      if (typeof schema.minProperties === 'number' && count < schema.minProperties) fail('minProperties', `must have at least ${schema.minProperties} key${schema.minProperties === 1 ? '' : 's'}`);
      if (typeof schema.maxProperties === 'number' && count > schema.maxProperties) fail('maxProperties', `must have at most ${schema.maxProperties} key${schema.maxProperties === 1 ? '' : 's'}`);
      if (schema.propertyNames !== undefined) {
        for (const key of Object.keys(v)) {
          const test: SchemaResult = { problems: [], deprecated: [] };
          visit(schema.propertyNames as Schema, key, at(path, key), test);
          if (test.problems.length) out.problems.push({ path: at(path, key), keyword: 'propertyNames', message: `"${key}" is not a key allowed here (${test.problems[0].message})` });
        }
      }
      const properties = isObject(schema.properties) ? schema.properties : {};
      for (const [key, x] of Object.entries(v)) {
        if (x === undefined) continue;
        if (key in properties) visit(properties[key] as Schema, x, at(path, key), out);
        else if (schema.additionalProperties === false) out.problems.push({ path: at(path, key), keyword: 'additionalProperties', message: `"${key}" is not a key here` });
        else if (isObject(schema.additionalProperties)) visit(schema.additionalProperties, x, at(path, key), out);
      }
    }
  };
  const out: SchemaResult = { problems: [], deprecated: [] };
  visit(root, value, '', out);
  return out;
}
