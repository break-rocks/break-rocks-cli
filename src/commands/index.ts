// The commands of the CLI, in the order of the help.
import { register } from '../registry.js';
import { capabilities, usage, whoami } from './account.js';
import { agentAttest, agentLogin } from './agent.js';
import { agentsActivity, agentsCreate, agentsDelete, agentsList, agentsReactivate, agentsRegenerate, agentsRename, agentsRestrict, agentsShow, agentsSuspend } from './agents.js';
import { help, schema, version } from './core.js';
import { operatorDelete, operatorKeygen, operatorLogin, operatorRecover, operatorRecoveryKeySet, operatorRegister, operatorRenew, sessionCommand } from './operator.js';
import { profileAdd, profileList, profileRemove, profileShow, profileUse } from './profile.js';
import { themeCheck, themePack, themePromptCommand, themeTypefaces, themeUnpack } from './theme.js';
import { walletBalance, walletFaucet, walletSet, walletShow } from './wallet.js';

register(
  help, version, schema,
  profileAdd, profileUse, profileList, profileShow, profileRemove,
  operatorKeygen, operatorRegister, operatorLogin, operatorRenew, operatorRecover, operatorRecoveryKeySet, operatorDelete,
  agentsCreate, agentsList, agentsShow, agentsRename, agentsSuspend, agentsReactivate, agentsDelete, agentsRestrict, agentsRegenerate, agentsActivity,
  agentLogin, agentAttest,
  walletSet, walletShow, walletBalance, walletFaucet,
  whoami, sessionCommand, usage, capabilities,
  themePromptCommand, themeCheck, themePack, themeUnpack, themeTypefaces,
);

