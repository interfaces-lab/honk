import {
  AccountId,
  AuthProviderId,
  ModelId,
  type AgentModelPolicy,
} from "@honk/contracts";
import { getModelOptionBooleanSelectionValue } from "./model";

export const CURSOR_PROVIDER_ID = "cursor";
export const CURSOR_ACCOUNT_ID = "cursor:default";
export const CURSOR_COMPOSER_MODEL_ID = "composer-2-5";
export const CURSOR_COMPOSER_MODEL_NAME = "Composer 2.5";
export const CURSOR_COMPOSER_FAST_OPTION_ID = "fast";
export const CURSOR_COMPOSER_DEFAULT_FAST = false;

export function createCursorComposerAgentPolicyModelSelection(
  fastEnabled = CURSOR_COMPOSER_DEFAULT_FAST,
): AgentModelPolicy["modelSelection"] {
  return {
    type: "explicit",
    authProviderId: AuthProviderId.make(CURSOR_PROVIDER_ID),
    accountId: AccountId.make(CURSOR_ACCOUNT_ID),
    modelId: ModelId.make(`${CURSOR_PROVIDER_ID}/${CURSOR_COMPOSER_MODEL_ID}`),
    options: [
      {
        id: CURSOR_COMPOSER_FAST_OPTION_ID,
        value: fastEnabled,
      },
    ],
  };
}

export function isCursorComposerPolicyModelSelection(
  modelSelection: AgentModelPolicy["modelSelection"],
): modelSelection is Extract<AgentModelPolicy["modelSelection"], { type: "explicit" }> {
  return (
    modelSelection.type === "explicit" &&
    modelSelection.authProviderId === CURSOR_PROVIDER_ID &&
    modelSelection.modelId === `${CURSOR_PROVIDER_ID}/${CURSOR_COMPOSER_MODEL_ID}`
  );
}

export function getCursorComposerFastEnabledFromPolicyModelSelection(
  modelSelection: AgentModelPolicy["modelSelection"],
): boolean {
  return isCursorComposerPolicyModelSelection(modelSelection)
    ? (getModelOptionBooleanSelectionValue(
        modelSelection.options,
        CURSOR_COMPOSER_FAST_OPTION_ID,
      ) ?? CURSOR_COMPOSER_DEFAULT_FAST)
    : CURSOR_COMPOSER_DEFAULT_FAST;
}
