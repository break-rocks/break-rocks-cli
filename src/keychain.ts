// The system keychain (D-235): where the private key of a local agent is kept. macOS: `security`
// (the login keychain); Linux: `secret-tool` (the Secret Service); Windows: the Credential Manager
// through PowerShell (CredWrite/CredRead/CredDelete of advapi32). Child processes only, no native
// module and no npm dependency; the secret always goes through stdin, never through the arguments
// (which other users of the system may read). BREAKROCKS_KEYCHAIN=off turns it off (a file instead).
// TEMPORARY exception to "no system binary" (README § Dette technique): decided with D-235.
import { spawnSync } from 'node:child_process';

export const KEYCHAIN_SERVICE = 'breakrocks';

export type Keychain = {
  /** The name shown to people: "macOS keychain", "Secret Service", "Windows Credential Manager". */
  readonly name: string;
  available(): boolean;
  /** Stores [secret] under [account]; false when the keychain refused it. */
  set(account: string, secret: string): boolean;
  get(account: string): string | undefined;
  delete(account: string): boolean;
};

type Run = (command: string, args: string[], input?: string) => { status: number | null; stdout: string; error?: Error };
const run: Run = (command, args, input) => {
  const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: 15_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', error: r.error };
};

// The PEM is kept as one line of base64 (security -w and the Credential Manager keep one line best).
const pack = (secret: string) => Buffer.from(secret, 'utf8').toString('base64');
const unpack = (stored: string) => Buffer.from(stored.trim(), 'base64').toString('utf8');
const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;

export function macKeychain(exec: Run = run): Keychain {
  return {
    name: 'macOS keychain',
    available: () => { const r = exec('/usr/bin/security', ['list-keychains']); return !r.error && r.status === 0; },
    // security -i reads its commands from stdin: the secret never appears in the arguments.
    set: (account, secret) => exec('/usr/bin/security', ['-i'], `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -l ${quote(`breakrocks ${account}`)} -w ${quote(pack(secret))}\n`).status === 0
      && exec('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]).status === 0,
    get: (account) => { const r = exec('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']); return r.status === 0 && r.stdout.trim() ? unpack(r.stdout) : undefined; },
    delete: (account) => exec('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]).status === 0,
  };
}

export function secretService(exec: Run = run, env: NodeJS.ProcessEnv = process.env): Keychain {
  return {
    name: 'Secret Service',
    available: () => { if (!env.DBUS_SESSION_BUS_ADDRESS) return false; const r = exec('secret-tool', ['--version']); return !r.error && r.status === 0; },
    set: (account, secret) => exec('secret-tool', ['store', `--label=breakrocks ${account}`, 'service', KEYCHAIN_SERVICE, 'account', account], pack(secret)).status === 0,
    get: (account) => { const r = exec('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', account]); return r.status === 0 && r.stdout.trim() ? unpack(r.stdout) : undefined; },
    delete: (account) => exec('secret-tool', ['clear', 'service', KEYCHAIN_SERVICE, 'account', account]).status === 0,
  };
}

// CredWrite/CredRead/CredDelete through Add-Type; the target and the secret come from stdin (one line each).
const WIN_TYPE = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class BrCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct C { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int BlobSize; public IntPtr Blob; public int Persist; public int AttrCount; public IntPtr Attrs; public string Alias; public string UserName; }
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredWriteW(ref C c, int f);
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredReadW(string t, int ty, int f, out IntPtr c);
  [DllImport("advapi32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CredDeleteW(string t, int ty, int f);
  [DllImport("advapi32")] static extern void CredFree(IntPtr p);
  public static bool Set(string t, string s) { var b = Encoding.UTF8.GetBytes(s); var c = new C(); c.Type = 1; c.TargetName = t; c.UserName = "breakrocks"; c.Persist = 2; c.BlobSize = b.Length; c.Blob = Marshal.AllocHGlobal(b.Length); Marshal.Copy(b, 0, c.Blob, b.Length); try { return CredWriteW(ref c, 0); } finally { Marshal.FreeHGlobal(c.Blob); } }
  public static string Get(string t) { IntPtr p; if (!CredReadW(t, 1, 0, out p)) return null; try { var c = (C)Marshal.PtrToStructure(p, typeof(C)); var b = new byte[c.BlobSize]; Marshal.Copy(c.Blob, b, 0, c.BlobSize); return Encoding.UTF8.GetString(b); } finally { CredFree(p); } }
  public static bool Del(string t) { return CredDeleteW(t, 1, 0); }
}
'@
$t = [Console]::In.ReadLine(); $s = [Console]::In.ReadLine()`;

export function windowsCredentials(exec: Run = run): Keychain {
  const ps = (body: string, input: string) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${WIN_TYPE}\n${body}`], input);
  const target = (account: string) => `${KEYCHAIN_SERVICE}:${account}`;
  return {
    name: 'Windows Credential Manager',
    available: () => { const r = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major']); return !r.error && r.status === 0; },
    set: (account, secret) => ps('if ([BrCred]::Set($t, $s)) { exit 0 } else { exit 1 }', `${target(account)}\n${pack(secret)}\n`).status === 0,
    get: (account) => { const r = ps('$v = [BrCred]::Get($t); if ($v) { [Console]::Out.Write($v); exit 0 } else { exit 1 }', `${target(account)}\n\n`); return r.status === 0 && r.stdout.trim() ? unpack(r.stdout) : undefined; },
    delete: (account) => ps('if ([BrCred]::Del($t)) { exit 0 } else { exit 1 }', `${target(account)}\n\n`).status === 0,
  };
}

const NONE: Keychain = { name: 'none', available: () => false, set: () => false, get: () => undefined, delete: () => false };

/** The keychain of this system, or none (BREAKROCKS_KEYCHAIN=off, or another system). */
export function systemKeychain(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Keychain {
  if (/^(off|0|false|no|file)$/i.test(env.BREAKROCKS_KEYCHAIN ?? '')) return NONE;
  if (platform === 'darwin') return macKeychain();
  if (platform === 'linux') return secretService(run, env);
  if (platform === 'win32') return windowsCredentials();
  return NONE;
}
