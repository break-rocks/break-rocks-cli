// Opening an address in the browser of the person (the browser sign-in, a payment page).
import { spawn } from 'node:child_process';

/**
 * Opens [url] in the browser of the person, without a shell: `open` (macOS), `xdg-open` (Linux and
 * the others), `rundll32 url.dll,FileProtocolHandler` (Windows). The one call of a program of the
 * system the CLI makes (README § Systems): optional (--no-open), and the address is always written
 * for the person to open it. False when it could not start.
 */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const [command, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}
