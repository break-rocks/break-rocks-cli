// The commands of the CLI, in the order of the help.
import { register } from '../registry.js';
import { help, schema, version } from './core.js';
import { profileAdd, profileList, profileRemove, profileShow, profileUse } from './profile.js';
import { themeCheck, themePack, themePromptCommand, themeTypefaces, themeUnpack } from './theme.js';

register(
  help, version, schema,
  profileAdd, profileUse, profileList, profileShow, profileRemove,
  themePromptCommand, themeCheck, themePack, themeUnpack, themeTypefaces,
);
