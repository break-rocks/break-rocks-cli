// The backend: native-sulfur (its own OAuth endpoints and GraphQL runtime per cell) is the only one since the former backend
// (talc, "legacy": Cognito, AppSync API v2, the agents host) was retired on 2026-11-28 (talc removal, phase B). --backend sulfur
// and BREAKROCKS_BACKEND=sulfur are still taken (deprecated: scripts and pages that name them keep working); legacy is refused.
import { usageError } from './errors.js';

/** A backend named by a person ([where]: the option or the variable): sulfur, else BACKEND_REMOVED (exit 2). */
export function checkBackend(value: string, where: string): 'sulfur' {
  const v = value.trim().toLowerCase();
  if (v === 'sulfur') return v;
  throw usageError('BACKEND_REMOVED', `${where}: the former backend (legacy, talc) was retired; native-sulfur is the only backend (${where} can be left out), not "${value}"`, { backend: value });
}
