// The completion of breakrocks: its model from the registry (each option and positional with the kind
// of its value, by the rules below), the dynamic values (profiles, recent universes and accounts,
// themes and layouts published by the profile: local files only) and what a command leaves in the
// history once it succeeded.
import { ConfigStore, DEFAULT_PROFILE, ENVIRONMENTS, configDir } from '../config.js';
import type { Context } from '../context.js';
import { GLOBAL_OPTIONS, GROUP_SUMMARIES } from '../help.js';
import { commands, type AnyCommand } from '../registry.js';
import { kebab, mainType, type JsonSchema } from '../schema.js';
import { FIELDS } from '../theme/check.js';
import { VERSION } from '../version.js';
import type { CommandModel, CompletionModel, DynamicValues, Kind, OptionModel } from './engine.js';
import { ADDRESS, historyDisabled, published, recent, remember, updatePublished } from './history.js';

const FILES = new Set(['file', 'archive', 'image', 'video', 'key', 'newKey', 'recoveryOut', 'images', 'out']);
const UNIVERSES = new Set(['universe', 'universes', 'in', 'appliedIn', 'subUniverse', 'before']);
const ACCOUNTS = new Set(['account', 'accounts', 'accountId', 'accountIds', 'with', 'creator', 'candidate']);
const PROFILE_COMMANDS = new Set(['profile use', 'profile show', 'profile remove']);
const none: Kind = { type: 'none' };
const free: Kind = { type: 'free' };
const dynamic = (source: string): Kind => ({ type: 'dynamic', source });

/** The string schema of a property: itself, the items of an array, or the string form of an anyOf. */
function stringForm(s: JsonSchema): JsonSchema | undefined {
  if (s.anyOf) return s.anyOf.find((x) => mainType(x) === 'string');
  if (mainType(s) === 'array') return s.items && mainType(s.items) === 'string' ? s.items : undefined;
  return mainType(s) === 'string' ? s : undefined;
}

/** The kind of the value of the property [name] of [command]. */
export function kindOf(command: string, name: string, schema: JsonSchema): Kind {
  if (mainType(schema) === 'boolean') return none;
  const enumValues = schema.enum ?? schema.items?.enum;
  if (enumValues) return { type: 'enum', values: enumValues.map(String) };
  const s = stringForm(schema);
  if (!s || s.format) return free;
  const description = schema.description ?? s.description ?? '';
  if (name === 'name' && PROFILE_COMMANDS.has(command)) return dynamic('profile');
  if (name === 'field') return { type: 'enum', values: FIELDS };
  if (FILES.has(name)) return /^The folder/.test(description) && !/\.zip/.test(description) ? { type: 'dir' } : { type: 'file' };
  if (name === 'theme') return dynamic('theme');
  if (name === 'layout' || name === 'layoutRef') return dynamic('layout');
  if (name === 'address') return dynamic('address');
  if (UNIVERSES.has(name) || ((name === 'to' || name === 'target') && /universe/i.test(description))) return dynamic('universe');
  if (ACCOUNTS.has(name)) return dynamic('account');
  return free;
}

function commandModel(c: AnyCommand): CommandModel {
  const positionals = c.args?.positionals ?? [];
  const props = c.input.properties;
  const aliases = Object.entries(c.args?.aliases ?? {});
  const options: OptionModel[] = Object.entries(props).filter(([name]) => !positionals.includes(name)).map(([name, s]) => ({
    flags: [`--${kebab(name)}`, ...aliases.filter(([, to]) => to === name).map(([flag]) => `--${flag}`)],
    kind: kindOf(c.name, name, s), description: s.description ?? '',
  }));
  return {
    name: c.name, summary: c.summary, options,
    positionals: positionals.map((name, i) => ({ kind: kindOf(c.name, name, props[name]), rest: i === positionals.length - 1 && mainType(props[name]) === 'array' })),
  };
}

const globalDescription = (flag: string) => GLOBAL_OPTIONS.find(([o]) => o.split(' ')[0] === flag)?.[1] ?? '';
const GLOBALS: OptionModel[] = [
  { flags: ['--json'], kind: none, description: globalDescription('--json') },
  { flags: ['--quiet', '-q'], kind: none, description: globalDescription('--quiet') },
  { flags: ['--fields'], kind: free, description: globalDescription('--fields') },
  { flags: ['--profile'], kind: dynamic('profile'), description: globalDescription('--profile') },
  { flags: ['--env'], kind: { type: 'enum', values: ENVIRONMENTS }, description: globalDescription('--env') },
  { flags: ['--yes', '-y'], kind: none, description: globalDescription('--yes') },
  { flags: ['--help', '-h'], kind: none, description: globalDescription('--help') },
  { flags: ['--version'], kind: none, description: globalDescription('--version') },
];

/** The model of the completion, from the registry: up to date by construction. */
export const completionModel = (): CompletionModel => ({
  program: 'breakrocks', version: VERSION, commands: commands().map(commandModel), globals: GLOBALS, groups: GROUP_SUMMARIES,
});

/** The profile the words name (--profile), else BREAKROCKS_PROFILE, else the current one. */
function profileOf(words: readonly string[], env: NodeJS.ProcessEnv, store: ConfigStore): string {
  for (let i = words.length - 2; i >= 0; i--) {
    if (words[i] === '--profile') return words[i + 1];
    if (words[i].startsWith('--profile=')) return words[i].slice('--profile='.length);
  }
  return env.BREAKROCKS_PROFILE ?? store.read().current ?? DEFAULT_PROFILE;
}

/** The dynamic values: from the configuration folder only, never from the network. */
export function dynamicValues(env: NodeJS.ProcessEnv): DynamicValues {
  const store = new ConfigStore(configDir(env));
  return (source, words) => {
    try {
      switch (source) {
        case 'profile': return Object.keys(store.read().profiles);
        case 'universe': return recent(store, '%');
        case 'account': return recent(store, '@');
        case 'address': return [...recent(store, '%'), ...recent(store, '@')];
        case 'theme': return published(store, profileOf(words, env, store), 'themes');
        case 'layout': return published(store, profileOf(words, env, store), 'layouts');
        default: return [];
      }
    } catch { return []; }
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The %universe/name of a theme or a layout in an answer (itself, or its "theme" or "layout"). */
function refIn(result: unknown): string | undefined {
  for (const o of [result, isObject(result) ? result.theme : undefined, isObject(result) ? result.layout : undefined]) {
    if (isObject(o) && typeof o.universe === 'string' && typeof o.name === 'string' && o.universe.startsWith('%')) return `${o.universe}/${o.name}`;
  }
  return undefined;
}
const PUBLISHING: Record<string, 'themes' | 'layouts'> = { 'theme publish': 'themes', 'theme copy': 'themes', 'layouts publish': 'layouts', 'layouts publish-version': 'layouts', 'layouts copy': 'layouts' };
const DELETING: Record<string, ['themes' | 'layouts', string]> = { 'theme delete': ['themes', 'theme'], 'layouts delete': ['layouts', 'layout'] };

/**
 * What a command that succeeded leaves for the completion: the universes and accounts of its input
 * (the properties completed with them, never a text), the theme or layout it published or deleted.
 * Never fails the command.
 */
export function rememberUse(ctx: Context, command: AnyCommand, input: Record<string, unknown>, result: unknown): void {
  if (historyDisabled(ctx.env)) return;
  try {
    const values: string[] = [];
    for (const [name, value] of Object.entries(input)) {
      const s = command.input.properties[name];
      const kind = s && kindOf(command.name, name, s);
      if (kind?.type !== 'dynamic' || !['universe', 'account', 'address'].includes(kind.source)) continue;
      for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string' && ADDRESS.test(v)) values.push(v);
    }
    remember(ctx.store, values, ctx.now());
    const publishing = PUBLISHING[command.name];
    const ref = publishing && !(isObject(result) && result.dryRun) ? refIn(result) : undefined;
    if (publishing && ref) updatePublished(ctx.store, ctx.profileName, publishing, { add: ref });
    const deleting = DELETING[command.name];
    if (deleting && typeof input[deleting[1]] === 'string') updatePublished(ctx.store, ctx.profileName, deleting[0], { remove: input[deleting[1]] as string });
  } catch { /* the completion is a convenience: a history that cannot be written is left alone */ }
}
