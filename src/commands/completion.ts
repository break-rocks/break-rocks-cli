// breakrocks completion <shell>: the completion script of bash, zsh, fish or PowerShell, generated
// from the registry (README § Autocomplétion); --install shows the line to add, writing nothing.
// breakrocks __complete <words…> (hidden): what to propose for the last word, for the scripts.
import { complete, completionLines } from '../completion/engine.js';
import { completionModel, dynamicValues } from '../completion/model.js';
import { SHELLS, completionScript, installation, type Shell } from '../completion/scripts.js';
import type { Io } from '../context.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, list, object, openObject, str } from '../schema.js';

type Install = { shell: Shell; line: string; where: string };
type CompletionResult = { shell?: Shell; script?: string; install?: Install[] };

const shellOf = (value: string): Shell => (value === 'powershell' ? 'pwsh' : (value as Shell));

/** The shell of the user, when its environment says it (SHELL on POSIX, PSModulePath for PowerShell). */
export function detectShell(env: NodeJS.ProcessEnv): Shell | undefined {
  const name = (env.SHELL ?? '').split(/[\\/]/).pop() ?? '';
  if ((SHELLS as readonly string[]).includes(name)) return name as Shell;
  if (env.PSModulePath) return 'pwsh';
  return undefined;
}

export const completion: Command<{ shell?: string; install?: boolean }, CompletionResult> = {
  name: 'completion', summary: 'Write the completion script of a shell: bash, zsh, fish or pwsh',
  description: 'The script is generated from the commands of this version (their options, the values of their enumerations, files and folders); profiles, recent universes and accounts and the themes the profile published come from local files, never from the network. --install shows the line to add to the configuration of the shell, and writes nothing.',
  examples: ['breakrocks completion zsh', 'breakrocks completion bash > ~/.local/share/bash-completion/completions/breakrocks', 'breakrocks completion --install', 'breakrocks completion pwsh | Out-String | Invoke-Expression'],
  input: object({
    shell: str('The shell', { enum: [...SHELLS, 'powershell'] }),
    install: bool('Show the line to add to the configuration of the shell (all four without a shell), writing nothing'),
  }),
  output: openObject({ shell: str('The shell'), script: str('The completion script'), install: list('How to install it', openObject({ shell: str('The shell'), line: str('The line'), where: str('Where it goes') })) }),
  args: { positionals: ['shell'] }, offline: true, mcp: false,
  run: (ctx, { shell, install }) => {
    const program = completionModel().program;
    if (install) {
      const shells = shell ? [shellOf(shell)] : [...SHELLS];
      return { install: shells.map((s) => ({ shell: s, ...installation(program, s) })) };
    }
    if (!shell) {
      const detected = detectShell(ctx.env);
      throw usageError('SHELL_REQUIRED', `Name the shell: breakrocks completion ${detected ?? '<bash|zsh|fish|pwsh>'} (breakrocks completion --install shows how to install it)`, { shells: [...SHELLS] });
    }
    const s = shellOf(shell);
    return { shell: s, script: completionScript(completionModel(), s) };
  },
  text: (r) => r.script ?? (r.install ?? []).map((i) => `${i.shell}: ${i.where}\n  ${i.line}`).join('\n\n'),
};

/** breakrocks __complete <words…>: a value per line (":files" or ":dirs" last when paths complete it); always exit 0. */
export function runComplete(words: readonly string[], io: Io): number {
  try {
    for (const line of completionLines(complete(completionModel(), words.length ? words : [''], dynamicValues(io.env)))) io.out.line(line);
  } catch { /* nothing to propose */ }
  return 0;
}
