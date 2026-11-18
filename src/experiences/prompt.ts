// The prompt kit of `experiences prompt`: a self-contained prompt that asks an external LLM for one experience
// template of an engine, as a JSON document that `experiences check` and `experiences import` then read. Built at run
// time from the contract the CLI carries (or --contract): the registry entry of the engine, the JSON Schema of the
// template narrowed to it, the limits it states, an example from the test vectors. The CLI never calls an LLM and
// sends nothing: the prompt is text for the person to give.
import { usageError } from '../errors.js';
import { engineSchema, keyOf, platformFields, templateFormat, type Contract, type Engine, type Json } from './contract.js';
import { MAX_DOCUMENT_BYTES, canonical } from './document.js';

/** A candidate place given to the LLM (--places-file): an id and/or a point, a name. */
export type Place = { id?: string; name: string; lat?: number; lon?: number; kind?: string; address?: string };
export const MAX_PLACES = 200;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The candidate places of a JSON value: a list, or { "places": [...] }, or { "items": [...] } (a page of the CLI), each
 * { "id"?, "name", "lat"?, "lon"? } or { "id"?, "name", "point": { "lat", "lon" } } (what `map places search --json`
 * answers), "kind" and "address" kept when given. Each needs a name and an id or a point.
 */
export function placesOf(value: unknown, file: string): Place[] {
  const list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.places) ? value.places : isObject(value) && Array.isArray(value.items) ? value.items : undefined;
  if (!list) throw usageError('PLACES_FILE_INVALID', `${file}: a JSON list of places, or { "places": [...] }`, { path: file });
  if (list.length > MAX_PLACES) throw usageError('PLACES_FILE_INVALID', `${file}: ${list.length} places, ${MAX_PLACES} at most in a prompt`, { path: file });
  return list.map((p, i) => {
    if (!isObject(p)) throw usageError('PLACES_FILE_INVALID', `${file}: place ${i + 1} is not an object`, { path: file, index: i });
    const point = isObject(p.point) ? p.point : p;
    const lat = num(point.lat), lon = num(point.lon ?? point.lng);
    const id = typeof p.id === 'string' && p.id ? p.id : typeof p.placeId === 'string' ? p.placeId : undefined;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) throw usageError('PLACES_FILE_INVALID', `${file}: place ${i + 1} has no "name"`, { path: file, index: i });
    if (!id && (lat === undefined || lon === undefined)) throw usageError('PLACES_FILE_INVALID', `${file}: place ${i + 1} ("${name}") has neither an "id" nor a point ("lat" and "lon", or "point")`, { path: file, index: i });
    if (lat !== undefined && (lat < -90 || lat > 90 || lon === undefined || lon < -180 || lon > 180)) throw usageError('PLACES_FILE_INVALID', `${file}: place ${i + 1} ("${name}"): a point is a latitude (-90 to 90) and a longitude (-180 to 180)`, { path: file, index: i });
    return { ...(id ? { id } : {}), name, ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}), ...(typeof p.kind === 'string' ? { kind: p.kind } : {}), ...(typeof p.address === 'string' ? { address: p.address } : {}) };
  });
}

/** "48.81,2.22,48.90,2.47" → its words; any other text as it is. */
export function areaText(area: string): string {
  const n = area.split(',').map((x) => Number(x.trim()));
  if (n.length === 4 && n.every(Number.isFinite) && n[0] < n[2] && Math.abs(n[0]) <= 90 && Math.abs(n[2]) <= 90) return `the box from latitude ${n[0]} to ${n[2]} and longitude ${n[1]} to ${n[3]} (south, west, north, east: ${area.trim()})`;
  return area.trim();
}

/** Every text of a language map in [schema] and its limit in visible characters: "/title": 100. */
function textLimits(schema: Json): { path: string; max: number; min: number }[] {
  const out: { path: string; max: number; min: number }[] = [];
  const resolve = (s: unknown): Json | undefined => {
    let x = s;
    for (let i = 0; i < 20 && isObject(x) && typeof x.$ref === 'string'; i++) x = (x.$ref as string).slice(2).split('/').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), schema);
    return isObject(x) ? x : undefined;
  };
  const walk = (s: unknown, path: string, depth: number) => {
    const r = resolve(s);
    if (!r || depth > 6) return;
    for (const x of (r.allOf as unknown[] | undefined) ?? []) walk(x, path, depth + 1);
    const values = resolve(r.additionalProperties);
    if (values && typeof values.maxLength === 'number' && r.propertyNames) out.push({ path, max: Math.floor(values.maxLength / 4), min: typeof values.minLength === 'number' ? values.minLength : 1 });
    for (const [k, v] of Object.entries((r.properties as Json | undefined) ?? {})) walk(v, `${path}/${k}`, depth + 1);
  };
  walk(schema, '', 0);
  return out;
}

const list = (xs: readonly unknown[] | undefined) => (xs?.length ? xs.join(', ') : 'none');
const enumValues = (schema: Json, name: string): string[] => {
  const p = (schema.properties as Json | undefined)?.[name];
  const items = isObject(p) && isObject(p.items) ? p.items : undefined;
  return Array.isArray(items?.enum) ? items.enum.map(String) : [];
};

export type PromptInput = { engine: Engine; theme?: string; area?: string; language?: string; stages?: number; places?: Place[]; owner?: string };
export type PromptResult = { prompt: string; engine: string; format: string; specs: string; contract: string; language: string; places: number; example: string | null };

/** The prompt for [input.engine], from [contract]. */
export function experiencePrompt(contract: Contract, input: PromptInput): PromptResult {
  const { engine } = input;
  const key = keyOf(engine);
  const format = templateFormat(contract);
  const schema = engineSchema(contract, engine);
  const language = input.language ?? 'en';
  const set = platformFields(contract);
  const limits = textLimits(schema);
  const warnings = enumValues(schema, 'warnings');
  const example = contract.examples[key];
  const exampleDoc = example ? canonical(Object.fromEntries(Object.entries(example.document).filter(([k]) => !set.includes(k))), contract.definition) : undefined;
  const places = input.places ?? [];
  const hasStages = JSON.stringify(schema).includes('"stages"');
  const owner = input.owner?.trim();

  const lines: string[] = [];
  lines.push(
    '# Task',
    '',
    `Write one experience of break.rocks, a social network, as a single JSON document: an experience template of the format ${format}, for the experience engine ${key}.`,
    '',
    `The engine ${key}: ${engine.what ?? '(no description in the registry)'}`,
    `- done: ${list(engine.places)}; proofs: ${list(engine.proofs)}; ranking measures: ${list(engine.rankingMeasures)}; progress widgets: ${list(engine.widgets)}; experience parameters may set: ${list(engine.parameterFields)}.`,
    '',
    `Theme: ${input.theme?.trim() || '(free: choose one that people can do safely)'}`,
    `Area: ${input.area ? areaText(input.area) : '(none given)'}`,
    `Language: ${language === 'en' ? 'English ("en")' : `"${language}" and English ("en"): every text map holds both keys, "${language}" written first in the language, "en" its English version`}`,
    ...(owner ? [`Owner: "${owner}"`] : []),
    ...(input.stages ? [`Stages: ${input.stages}`] : []),
    '',
    '# Answer',
    '',
    'Answer with the JSON document only: no Markdown fence, no comment, no text before or after it. One object, valid JSON (UTF-8).',
    '',
    '# Hard rules',
    '',
    `1. The document follows the JSON Schema below exactly. It is closed: no field outside it (an unknown field refuses the whole document), every required field present.`,
    `2. "format" is "${format}" and "engine" is {"name": "${engine.name}", "version": ${engine.version}}.`,
    `3. Never write the fields the platform sets: ${set.map((f) => `"${f}"`).join(', ') || 'none'}.`,
    `4. "owner": ${owner ? `exactly "${owner}".` : 'the account of the person, "@<handle>" (write "@me" when it is not given: the import replaces it with the account of the person), or a universe "%<name>".'}`,
    '5. "name": lowercase, a letter first, then letters, digits and "-", 2 to 50 characters, never "event" nor "route"; short and telling (it becomes the address <owner>*<name>).',
    `6. Lengths count visible characters (an emoji is one): ${limits.map((l) => `${l.path} ${l.min} to ${l.max}`).join('; ') || 'as the schema says'} per language, "en" always given. The whole document weighs ${MAX_DOCUMENT_BYTES / 1024} KB at most.`,
    places.length
      ? `7. No invented place. Every place, point, stage or identifier the document names comes from the candidate places below, its "id" and its coordinates copied exactly, character for character; a candidate that does not fit is left out, never changed.${hasStages ? '' : ` The template of ${key} has no field for a place: use them only to fit the experience to where it is done, and copy no coordinate into the document.`}`
      : '7. No invented place: name no real place, address, point or identifier in the document; where a field asks for an identifier the person did not give, write "REPLACE-ME" so that the check refuses it until the person sets it.',
    '8. No reward, no prize, no money, no payment, no price, no gambling, nothing to buy or sell: an experience is done for itself.',
    `9. Nothing dangerous: nothing that endangers the participants or others, nothing illegal, no trespassing, no dare that risks an injury, nothing hateful or sexual. The instruction says plainly what to do and how it is proved.${warnings.length ? ` Declare "warnings" honestly: ${warnings.join(', ')} (PHYSICAL_EFFORT for an effort of the body, RISKY_PLACE for a place that asks care); none when neither applies.` : ''}`,
    `10. Write ${language === 'en' ? 'in English' : `in "${language}" and in English`}; no other language key.`,
    ...(input.stages ? [`11. ${hasStages ? `About ${input.stages} stages, in a sensible order.` : `The person asked for about ${input.stages} steps: the template of ${key} has no stages, so describe them in the instruction.`}`] : []),
    '',
    `# JSON Schema of the document (${key}, from definition.schema.json of the specs ${contract.version})`,
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
  );
  if (exampleDoc) lines.push('', `# Example (from the test vectors of the specs, ${example.file}, "${example.key}"; follow its form, not its content)`, '', '```json', JSON.stringify(exampleDoc, null, 2), '```');
  if (places.length) lines.push('', `# Candidate places (${places.length}; the only places the document may name)`, '', '```json', JSON.stringify(places, null, 2), '```');
  lines.push('', '# Now', '', `Write the ${key} experience as one JSON document, nothing else.`);
  return { prompt: lines.join('\n'), engine: key, format, specs: contract.version, contract: contract.source, language, places: places.length, example: example ? `${example.file}#${example.key}` : null };
}
