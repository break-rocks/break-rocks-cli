// The archive of a theme as the import of the apps reads it (the theme studio of the web app, themeBundle.ts): a ZIP of
// the theme document and the images it names. The document is "theme.json" (in any folder), else the only JSON file
// (IMPORT_NO_JSON without one, IMPORT_SEVERAL_JSON with several and none named "theme.json"); each image is matched by
// its name whatever its folder (case aside), else by the same name with another extension; the files the systems add
// (__MACOSX, .DS_Store…) are left out. theme check and theme publish take such an archive in place of a JSON file:
// it is read into a private temporary folder (its files by their names), removed afterwards.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { usageError } from '../errors.js';
import { isSystemFile, readZip, zipEntryBytes } from './zip.js';

export const isZipName = (name: string) => /\.zip$/i.test(name);
const isJsonName = (name: string) => /\.json$/i.test(name);
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i;

/** The theme document among [paths], as the import of the apps chooses it. */
export function documentOf(paths: readonly string[]): string {
  const json = paths.filter((p) => isJsonName(p) && !isSystemFile(p));
  const named = json.filter((p) => basename(p.replaceAll('\\', '/')).toLowerCase() === 'theme.json');
  if (named.length === 1) return named[0];
  if (json.length === 1) return json[0];
  throw json.length
    ? usageError('IMPORT_SEVERAL_JSON', `The archive holds ${json.length} JSON files and none is named theme.json`)
    : usageError('IMPORT_NO_JSON', 'The archive holds no theme document (theme.json)');
}

export type OpenedArchive = { dir: string; document: string; images: string[]; entries: string[]; close: () => void };

/** Reads the archive [path] into a temporary folder: its theme document and its images, each by its name. */
export function openArchive(path: string): OpenedArchive {
  const bytes = new Uint8Array(readFileSync(path));
  const entries = readZip(bytes);
  const document = documentOf(entries.map((e) => e.path));
  const dir = mkdtempSync(join(tmpdir(), 'breakrocks-theme-'));
  const close = () => rmSync(dir, { recursive: true, force: true });
  try {
    const written = new Set<string>();
    const images: string[] = [];
    let documentFile = '';
    for (const entry of entries) {
      const name = basename(entry.path);
      const isDocument = entry.path === document;
      if (!isDocument && !IMAGE_NAME.test(name)) continue;
      const target = join(dir, isDocument ? 'theme.json' : name);
      if (written.has(target.toLowerCase())) continue;
      written.add(target.toLowerCase());
      writeFileSync(target, zipEntryBytes(bytes, entry));
      if (isDocument) documentFile = target; else images.push(target);
    }
    return { dir, document: documentFile, images, entries: entries.map((e) => e.path), close };
  } catch (e) { close(); throw e; }
}
