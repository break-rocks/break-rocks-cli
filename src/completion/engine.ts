// The completion of the command line, independent of the CLI it serves: a model (the commands, their
// options and positionals, each value with its kind), the tree of its words, and what to propose for
// the words typed so far. `<program> __complete <words…>` answers with it, and the scripts of the
// shells (scripts.ts) carry the same model and the same walk, asking `__complete` only for the
// dynamic values (read from local files, never from the network).

/** What a value is completed with. */
export type Kind =
  | { type: 'none' } // a boolean option: no value
  | { type: 'free' } // a value, nothing to propose
  | { type: 'enum'; values: readonly string[] }
  | { type: 'file' }
  | { type: 'dir' }
  | { type: 'dynamic'; source: string };

export type OptionModel = { flags: readonly string[]; kind: Kind; description: string };
export type PositionalModel = { kind: Kind; rest: boolean };
export type CommandModel = { name: string; summary: string; options: readonly OptionModel[]; positionals: readonly PositionalModel[] };
export type CompletionModel = {
  program: string;
  version: string;
  commands: readonly CommandModel[];
  /** The options every command takes. */
  globals: readonly OptionModel[];
  /** The summary of a group of commands ("agents", "universes favorite"), when it has one. */
  groups: Readonly<Record<string, string>>;
};

export type Node = { path: string; children: Map<string, string>; command?: CommandModel };

/** The words of the command line as a tree: a node per prefix of a command name, the root "". */
export function tree(model: CompletionModel): Map<string, Node> {
  const nodes = new Map<string, Node>([['', { path: '', children: new Map() }]]);
  for (const command of model.commands) {
    const words = command.name.split(' ');
    for (let i = 1; i <= words.length; i++) {
      const path = words.slice(0, i).join(' ');
      if (!nodes.has(path)) nodes.set(path, { path, children: new Map() });
      nodes.get(words.slice(0, i - 1).join(' '))!.children.set(words[i - 1], '');
    }
    nodes.get(command.name)!.command = command;
  }
  for (const node of nodes.values()) {
    for (const word of node.children.keys()) {
      const path = node.path ? `${node.path} ${word}` : word;
      const child = nodes.get(path)!;
      node.children.set(word, model.groups[path] ?? child.command?.summary ?? [...child.children.keys()].join(', '));
    }
  }
  return nodes;
}

/** The option [flag] of [command] (its own first, then the global ones). */
export function optionOf(model: CompletionModel, command: CommandModel | undefined, flag: string): OptionModel | undefined {
  return command?.options.find((o) => o.flags.includes(flag)) ?? model.globals.find((o) => o.flags.includes(flag));
}

export type Walk = { node: Node; positional: number; expecting?: Kind; afterDashes: boolean };

/** Where the words before the one completed lead: the node of the command, the positionals given, an option waiting for its value. */
export function walk(model: CompletionModel, nodes: Map<string, Node>, before: readonly string[]): Walk {
  let node = nodes.get('')!;
  let positional = 0;
  let expecting: Kind | undefined;
  let afterDashes = false;
  for (const word of before) {
    if (expecting) { expecting = undefined; continue; }
    if (afterDashes) { positional++; continue; }
    if (word === '--') { afterDashes = true; continue; }
    if (word.length > 1 && word.startsWith('-')) {
      if (word.includes('=')) continue;
      const option = optionOf(model, node.command, word);
      if (option && option.kind.type !== 'none') expecting = option.kind;
      continue;
    }
    if (positional === 0 && node.children.has(word)) { node = nodes.get(node.path ? `${node.path} ${word}` : word)!; continue; }
    positional++;
  }
  return { node, positional, expecting, afterDashes };
}

/** The kind of the positional number [index] of [command] (the last one repeats when it takes the words left). */
export function positionalKind(command: CommandModel | undefined, index: number): Kind | undefined {
  const list = command?.positionals ?? [];
  if (index < list.length) return list[index].kind;
  const last = list[list.length - 1];
  return last?.rest ? last.kind : undefined;
}

export type Candidate = { value: string; description?: string };
export type Completion = { values: Candidate[]; directive?: 'files' | 'dirs' };
/** The values of a dynamic source, read from local files (never from the network). */
export type DynamicValues = (source: string, words: readonly string[]) => readonly string[];

const startsWith = (value: string, prefix: string) => value.toLowerCase().startsWith(prefix.toLowerCase());

function valuesOf(kind: Kind | undefined, current: string, dynamic: DynamicValues, words: readonly string[], prefix = ''): Completion {
  if (!kind) return { values: [] };
  switch (kind.type) {
    case 'enum': return { values: kind.values.filter((v) => startsWith(v, current)).map((v) => ({ value: prefix + v })) };
    case 'dynamic': return { values: [...new Set(dynamic(kind.source, words))].filter((v) => startsWith(v, current)).map((v) => ({ value: prefix + v })) };
    case 'file': return { values: [], directive: 'files' };
    case 'dir': return { values: [], directive: 'dirs' };
    default: return { values: [] };
  }
}

/** What to propose for the last of [words] (the words after the program, the last one being completed, maybe empty). */
export function complete(model: CompletionModel, words: readonly string[], dynamic: DynamicValues): Completion {
  const nodes = tree(model);
  const current = words.length ? words[words.length - 1] : '';
  const { node, positional, expecting, afterDashes } = walk(model, nodes, words.slice(0, -1));
  if (expecting) return valuesOf(expecting, current, dynamic, words);
  if (!afterDashes && current.startsWith('-')) {
    const eq = current.indexOf('=');
    if (current.startsWith('--') && eq > 0) {
      const option = optionOf(model, node.command, current.slice(0, eq));
      return option && option.kind.type !== 'none' ? valuesOf(option.kind, current.slice(eq + 1), dynamic, words, current.slice(0, eq + 1)) : { values: [] };
    }
    const options = [...(node.command?.options ?? []), ...model.globals];
    const seen = new Set<string>();
    const values: Candidate[] = [];
    for (const o of options) for (const flag of o.flags) {
      if (seen.has(flag) || !flag.startsWith(current)) continue;
      seen.add(flag);
      values.push({ value: flag, description: o.description });
    }
    return { values };
  }
  const children: Candidate[] = positional === 0 && !afterDashes ? [...node.children].filter(([w]) => w.startsWith(current)).map(([value, description]) => ({ value, description })) : [];
  const rest = valuesOf(positionalKind(node.command, positional), current, dynamic, words);
  return { values: [...children, ...rest.values], ...(rest.directive ? { directive: rest.directive } : {}) };
}

/** The answer of `__complete`: a value per line ("value<TAB>description" with [describe]), then ":files" or ":dirs" when paths complete it. */
export function completionLines(completion: Completion, describe = false): string[] {
  const lines = completion.values.map((c) => (describe && c.description ? `${c.value}\t${c.description}` : c.value));
  if (completion.directive) lines.push(`:${completion.directive}`);
  return lines;
}
