// D-303 (0.18.0): the operations of before specs v83.1.0 that had no command. Every command added is run from
// each of its examples against a scripted API (no network): it sends its operation, in text and in JSON, and is
// an MCP tool (unless it says otherwise). The commands whose input is more than their arguments have tests of
// their own below.
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { meCommands } from '../src/commands/me.js';
import { tools } from '../src/mcp/server.js';
import type { AnyCommand } from '../src/registry.js';
import { scripted } from './scripted.js';

export const ADDED: AnyCommand[] = [...meCommands];

/** The words of an example, as a shell splits them (quotes kept together), without "breakrocks". */
export function words(example: string): string[] {
  const out: string[] = [];
  for (const m of example.replace(/<[^>]+>/g, 'x').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return out[0] === 'breakrocks' ? out.slice(1) : out;
}
const opOf = (c: AnyCommand) => /The (?:query|mutation) (\w+) of the API/.exec(c.description ?? '')?.[1];
/** The examples that need more than the command line (a file, the standard input): tested apart. */
const APART = new Set(['breakrocks me profile set --avatar-file ./me.png', 'breakrocks me password', 'printf "%s\\n%s\\n" "$OLD" "$NEW" | breakrocks me password --password-stdin']);

describe('the commands of the operations of before v83.1.0', () => {
  const titles = new Set(tools().map((t) => t.title));
  for (const command of ADDED) {
    it(`${command.name}: its examples send ${opOf(command)}`, async () => {
      expect(opOf(command)).toBeTruthy();
      if (command.mcp !== false) expect(titles.has(`breakrocks ${command.name}`)).toBe(true);
      for (const example of command.examples.filter((e) => !APART.has(e))) {
        for (const json of [false, true]) {
          const { h, calls } = scripted();
          const code = await h.run('--yes', ...(json ? ['--json'] : []), ...words(example));
          expect(code, `${example}${json ? ' --json' : ''}: ${h.all()}`).toBe(0);
          expect(calls.map((c) => c.field)).toContain(opOf(command));
        }
      }
    });
  }
});

describe('the account', () => {
  it('sends an avatar file, then sets it', async () => {
    const { h, calls } = scripted({ requestAvatarUpload: { id: 'up1', url: 'https://s3.test/up', fields: '{"key":"k"}' }, updateProfile: { id: 'a1', handle: 'alice', displayName: 'Alice', links: [] } });
    // A PNG of 1×1 pixel.
    writeFileSync(join(h.dir, 'me.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    h.io.cwd = h.dir;
    expect(await h.run('me', 'profile', 'set', '--avatar-file', 'me.png', '--bio', 'Cyclist')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestAvatarUpload', 'POST https://s3.test/up', 'updateProfile']);
    expect(calls[0].variables).toMatchObject({ c: 'image/png' });
    expect(calls[2].variables).toMatchObject({ input: { avatar: 'up1', bio: 'Cyclist' } });
    expect(h.lines.at(-1)).toBe('@alice  Alice');
    expect(await h.run('me', 'profile', 'set', '--avatar-file', 'me.png', '--avatar', 'up2')).toBe(2);
  });
  it('changes the password from the standard input, never from an option', async () => {
    const { h, calls } = scripted({ changePassword: true });
    h.io.readStdin = async () => 'old secret\nnew secret\n';
    expect(await h.run('me', 'password', '--password-stdin')).toBe(0);
    expect(calls[0].variables).toMatchObject({ currentPassword: 'old secret', newPassword: 'new secret' });
    expect(h.all()).not.toContain('secret');
    expect(await h.run('me', 'password', '--current-password', 'x')).toBe(2);
    h.io.readStdin = async () => 'only one\n';
    expect(await h.run('me', 'password', '--password-stdin')).toBe(2);
    expect(tools().some((t) => t.title === 'breakrocks me password')).toBe(false);
  });
  it('asks for a confirmation before an erasure or a deletion', async () => {
    const { h, calls } = scripted();
    expect(await h.run('me', 'data', 'erase', 'LOCATION')).toBe(2);
    expect(await h.run('me', 'delete', '@alice')).toBe(2);
    expect(calls).toEqual([]);
    expect(await h.run('--yes', 'me', 'delete', '@alice')).toBe(0);
    expect(calls[0].variables).toMatchObject({ handle: 'alice' });
  });
});
