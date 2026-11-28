// The web app of an environment (https://<env>.break.rocks; production serves the app on beta.break.rocks until the launch):
// the links the CLI builds point to it. BREAKROCKS_WEB_URL replaces it. TEMPORARY (technical debt, until the launch):
// production's host is beta.break.rocks. The API's hosts are native-sulfur's cells (src/sulfur/http.ts).
import type { Context } from './context.js';
import type { Environment } from './config.js';

export const WEB_HOSTS: Record<Environment, string> = { dev: 'https://dev.break.rocks', staging: 'https://staging.break.rocks', prod: 'https://beta.break.rocks' };
export const webOrigin = (ctx: Context, env: Environment) => new URL(ctx.env.BREAKROCKS_WEB_URL ?? WEB_HOSTS[env]).origin;
