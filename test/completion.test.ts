import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { completion } from '../src/commands/completion.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { complete } from '../src/completion/engine.js';
import { HISTORY_SIZE, historyFile, remember, recent } from '../src/completion/history.js';
import { completionModel, rememberUse } from '../src/completion/model.js';
import { SHELLS, completionScript, type Shell } from '../src/completion/scripts.js';
import { ConfigStore } from '../src/config.js';
import { commands, findCommand } from '../src/registry.js';
import { kebab } from '../src/schema.js';
import { harness, last } from './helpers.js';

const POSIX = process.platform !== 'win32';
/** Whether [program] runs here (never on Windows for bash: its bash may be WSL without a distribution). */
const available = (program: string, args: string[]) => (program === 'bash' && !POSIX ? false : spawnSync(program, args, { encoding: 'utf8' }).status === 0);
const dir = () => mkdtempSync(join(tmpdir(), 'breakrocks-completion-'));
const scriptFile = (shell: Shell) => { const file = join(dir(), `breakrocks.${shell === 'pwsh' ? 'ps1' : shell}`); writeFileSync(file, completionScript(completionModel(), shell)); return file; };

describe('the completion scripts', () => {
  for (const shell of SHELLS) {
    it(`${shell}: every command, every option and the values of the enumerations, from the registry`, () => {
      const script = completionScript(completionModel(), shell);
      for (const c of commands()) {
        for (const word of c.name.split(' ')) expect(script, c.name).toContain(word);
        const positionals = c.args?.positionals ?? [];
        if (positionals.length || Object.keys(c.input.properties).length) expect(script, c.name).toContain(shell === 'bash' || shell === 'zsh' ? `'${c.name}')` : shell === 'fish' ? `case '${c.name}'` : `'${c.name}'`);
        for (const name of Object.keys(c.input.properties)) if (!positionals.includes(name)) expect(script, `${c.name} --${kebab(name)}`).toContain(`--${kebab(name)}`);
      }
      expect(script).toContain('e:post,clip');
      expect(script).toContain('y:universe');
      expect(script).toContain('__complete');
      expect(script).not.toMatch(/\r/);
    });
  }
  it('bash and zsh: the syntax checked (bash -n, zsh -n) where they are', () => {
    for (const shell of ['bash', 'zsh'] as const) {
      if (!available(shell, ['-c', 'true'])) continue;
      const r = spawnSync(shell, ['-n', scriptFile(shell)], { encoding: 'utf8' });
      expect(r.stderr, shell).toBe('');
      expect(r.status, shell).toBe(0);
    }
  });
  it('fish and pwsh: the structure, and the syntax where they are', () => {
    const fish = completionScript(completionModel(), 'fish');
    expect(fish).toMatch(/^complete -c breakrocks -f -a '\(__breakrocks_complete\)'$/m);
    expect(fish.match(/^function /gm)?.length).toBe(fish.match(/^end$/gm)?.length);
    const pwsh = completionScript(completionModel(), 'pwsh');
    expect(pwsh).toContain("Register-ArgumentCompleter -Native -CommandName @('breakrocks', 'breakrocks.exe')");
    expect(pwsh.split('{').length).toBe(pwsh.split('}').length);
    if (available('fish', ['-c', 'true'])) expect(spawnSync('fish', ['--no-execute', scriptFile('fish')], { encoding: 'utf8' }).status).toBe(0);
    if (available('pwsh', ['-NoProfile', '-Command', 'exit 0'])) {
      const file = scriptFile('pwsh');
      const r = spawnSync('pwsh', ['-NoProfile', '-Command', `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); $e.Count`], { encoding: 'utf8' });
      expect(r.stdout.trim()).toBe('0');
    }
  }, 60_000);
  it('bash proposes the commands, the options and their values (the script run)', () => {
    if (!available('bash', ['-c', 'true'])) return;
    const file = scriptFile('bash');
    const cases: [string[], string][] = [
      [['po'], 'posts post polls'], [['posts', 'list', '--k'], '--kind'], [['posts', 'list', '--kind', ''], 'post clip'],
      [['universes', 'favorite', ''], 'add remove move'], [['--json', 'completion', ''], 'bash zsh fish pwsh powershell'],
    ];
    const lines = cases.map(([words]) => `t ${words.map((w) => `'${w}'`).join(' ')}`);
    const r = spawnSync('bash', ['-c', `source '${file}'; t() { COMP_WORDS=(breakrocks "$@"); COMP_CWORD=$#; COMPREPLY=(); __breakrocks; echo "\${COMPREPLY[*]}"; }; ${lines.join('; ')}`], { encoding: 'utf8' });
    expect(r.stdout.trim().split('\n')).toEqual(cases.map(([, out]) => out));
  });
  it('PowerShell proposes the commands, the options and their values (TabExpansion2) where it is', () => {
    if (!available('pwsh', ['-NoProfile', '-Command', 'exit 0'])) return;
    const file = scriptFile('pwsh');
    const inputs = ['breakrocks po', 'breakrocks posts list --k', 'breakrocks posts list --kind ', 'breakrocks universes favorite '];
    const command = `. '${file.replace(/'/g, "''")}'; foreach ($l in @(${inputs.map((i) => `'${i}'`).join(', ')})) { ((TabExpansion2 -inputScript $l -cursorColumn $l.Length).CompletionMatches | ForEach-Object { $_.CompletionText }) -join ' ' }`;
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
    expect(r.stdout.trim().split(/\r?\n/)).toEqual(['posts post polls', '--kind', 'post clip', 'add remove move']);
  }, 60_000);
});

describe('breakrocks completion', () => {
  it('writes the script of a shell, in text and in JSON', async () => {
    const h = harness();
    expect(await h.run('completion', 'zsh')).toBe(0);
    expect(h.lines[0]).toMatch(/^#compdef breakrocks/);
    expect(await h.run('completion', 'powershell', '--json')).toBe(0);
    expect(last<{ shell: string; script: string }>(h)).toMatchObject({ shell: 'pwsh', script: expect.stringContaining('Register-ArgumentCompleter') });
  });
  it('shows the line to add with --install, writing nothing', async () => {
    const h = harness();
    expect(await h.run('completion', '--install')).toBe(0);
    const text = h.lines[0];
    expect(text).toContain('eval "$(breakrocks completion zsh)"');
    expect(text).toContain('breakrocks completion bash > ~/.local/share/bash-completion/completions/breakrocks');
    expect(text).toContain('breakrocks completion fish > ~/.config/fish/completions/breakrocks.fish');
    expect(text).toContain('breakrocks completion pwsh | Out-String | Invoke-Expression');
    expect(await h.run('completion', 'fish', '--install', '--json')).toBe(0);
    expect(last<{ install: unknown[] }>(h).install).toHaveLength(1);
  });
  it('asks for the shell without one (exit 2) and is not an MCP tool', async () => {
    const h = harness({ env: { SHELL: '/bin/zsh' } });
    expect(await h.run('completion', '--json')).toBe(2);
    expect(last<{ error: { code: string; message: string } }>(h).error).toMatchObject({ code: 'SHELL_REQUIRED', message: expect.stringContaining('completion zsh') });
    expect(completion.mcp).toBe(false);
    expect(findCommand(['completion'])?.command.offline).toBe(true);
  });
});

describe('breakrocks __complete', () => {
  const run = async (h: ReturnType<typeof harness>, ...words: string[]) => { const from = h.lines.length; expect(await h.run('__complete', ...words)).toBe(0); return h.lines.slice(from); };
  it('completes the commands, the options and their values, hidden from the help', async () => {
    const h = harness();
    expect(await run(h, 'po')).toEqual(expect.arrayContaining(['post', 'posts']));
    expect(await run(h, 'posts', 'list', '--k')).toEqual(['--kind']);
    expect(await run(h, 'posts', 'list', '--kind', '')).toEqual(['post', 'clip']);
    expect(await run(h, 'posts', 'list', '--kind=c')).toEqual(['--kind=clip']);
    expect(await run(h, '--env', '')).toEqual(['dev', 'staging', 'prod']);
    expect(await run(h, 'theme', 'check', '')).toEqual([':files']);
    expect(await run(h, 'theme', 'unpack', 'a.zip', '--out', '')).toEqual([':dirs']);
    expect(await run(h, 'theme', 'prompt', '--field', 'SP')).toEqual(['SPORT']);
    const options = await run(h, 'posts', 'list', '--json', '--');
    expect(options).toEqual(expect.arrayContaining(['--kind', '--watch', '--json', '--profile', '--env']));
    expect(options).not.toContain('-q');
    expect(await run(h, 'posts', 'list', '--', '--')).toEqual([]);
    expect(await h.run('help')).toBe(0);
    expect(h.lines[h.lines.length - 1]).not.toContain('__complete');
  });
  it('completes the profiles and the universes of the history, without the network', async () => {
    const h = harness();
    expect(await h.run('profile', 'add', 'atlas', '--env', 'dev')).toBe(0);
    expect(await h.run('theme', 'prompt', '--field', 'sport', '--mood', 'stadium at night', '--name', 'stade-nuit', '--universe', '%test-village-sport')).toBe(0);
    expect(await run(h, '--profile', '')).toEqual(['atlas']);
    expect(await run(h, 'profile', 'use', 'a')).toEqual(['atlas']);
    expect(await run(h, 'universes', 'show', '%te')).toEqual(['%test-village-sport']);
    expect(await run(h, 'posts', 'list', '%')).toEqual(['%test-village-sport']);
    expect(await run(h, 'block', '@')).toEqual([]);
  });
  it('completes the themes and layouts the profile published, and forgets those deleted', async () => {
    const h = harness();
    const ctx = new Context(h.io, NO_FLAGS);
    rememberUse(ctx, findCommand(['theme', 'publish'])!.command, { file: 'theme.json', in: '%paris' }, { theme: { universe: '%paris', name: 'stade-nuit' }, uploads: [], warnings: 0 });
    rememberUse(ctx, findCommand(['layouts', 'publish'])!.command, { document: '{}', in: '%paris' }, { universe: '%paris', name: 'agora' });
    expect(await run(h, 'theme', 'try', '')).toEqual(['%paris/stade-nuit']);
    expect(await run(h, 'layouts', 'show', '%p')).toEqual(['%paris/agora']);
    expect(await run(h, 'universes', 'show', '')).toEqual(['%paris']);
    rememberUse(ctx, findCommand(['theme', 'delete'])!.command, { theme: '%paris/stade-nuit' }, {});
    expect(await run(h, 'theme', 'try', '')).toEqual([]);
  });
});

describe('the history of the completion', () => {
  it('keeps the last 100 addresses, the most recent first, for the user alone', () => {
    const store = new ConfigStore(join(dir(), 'config'));
    const now = Date.parse('2026-10-23T10:00:00Z');
    for (let i = 0; i < 120; i++) remember(store, [`%u${i}`], now + i);
    const universes = recent(store, '%');
    expect(universes).toHaveLength(HISTORY_SIZE);
    expect(universes[0]).toBe('%u119');
    remember(store, ['%u50'], now + 200);
    expect(recent(store, '%')[0]).toBe('%u50');
    expect(recent(store, '%')).toHaveLength(HISTORY_SIZE);
    if (POSIX) expect(spawnSync('ls', ['-l', historyFile(store)], { encoding: 'utf8' }).stdout).toMatch(/^-rw-------/);
  });
  it('never keeps a text: only the addresses of the properties completed with them', () => {
    const h = harness();
    const ctx = new Context(h.io, NO_FLAGS);
    rememberUse(ctx, findCommand(['post'])!.command, { text: '@secret %hidden', in: '%paris', link: '@nope' }, { id: 'p1' });
    rememberUse(ctx, findCommand(['dm'])!.command, { account: '@gabriel', text: '@other' }, { id: 'm1' });
    const saved = readFileSync(historyFile(ctx.store), 'utf8');
    expect(saved).toContain('%paris');
    expect(saved).toContain('@gabriel');
    expect(saved).not.toMatch(/secret|hidden|nope|other/);
  });
  it('keeps nothing with BREAKROCKS_NO_HISTORY=1', async () => {
    const h = harness({ env: { BREAKROCKS_NO_HISTORY: '1' } });
    expect(await h.run('theme', 'prompt', '--field', 'sport', '--mood', 'x', '--name', 'stade-nuit', '--universe', '%test-village-sport')).toBe(0);
    expect(complete(completionModel(), ['universes', 'show', '%'], () => []).values).toEqual([]);
    expect(await h.run('__complete', 'universes', 'show', '%')).toBe(0);
    expect(h.lines[h.lines.length - 1]).not.toBe('%test-village-sport');
  });
});
