// The backend switch (client port plan, § Switch strategy): one CLI talks to the former backend ("legacy": Cognito,
// AppSync API v2, the agents host) or to the new one ("sulfur", native-sulfur: its own OAuth endpoints and GraphQL runtime
// per cell). Chosen per run with --backend, else BREAKROCKS_BACKEND, else the profile's key (config set backend), else the
// former backend: the default flips with the release that moves the testers (TO-CONFIRM: the release that flips it).
import type { Profile } from './config.js';
import { usageError } from './errors.js';

export const BACKENDS = ['legacy', 'sulfur'] as const;
export type Backend = (typeof BACKENDS)[number];
export const DEFAULT_BACKEND: Backend = 'legacy';

export const isBackend = (value: unknown): value is Backend => (BACKENDS as readonly unknown[]).includes(value);

/** A backend named by a person ([where]: the option or variable), refused with BACKEND_INVALID (exit 2). */
export function checkBackend(value: string, where: string): Backend {
  const v = value.trim().toLowerCase();
  if (isBackend(v)) return v;
  throw usageError('BACKEND_INVALID', `${where} is legacy or sulfur, not "${value}"`, { backend: value });
}

/** The backend of a run: the option, the variable, the profile, the default. */
export function backendOf(flag: Backend | undefined, env: NodeJS.ProcessEnv, profile: Profile | undefined): Backend {
  if (flag) return flag;
  const fromEnv = env.BREAKROCKS_BACKEND?.trim();
  if (fromEnv) return checkBackend(fromEnv, 'BREAKROCKS_BACKEND');
  return profile?.backend ?? DEFAULT_BACKEND;
}
