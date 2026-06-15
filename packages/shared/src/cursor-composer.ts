import {
  AccountId,
  AuthProviderId,
  ModelId,
  type AgentModelPolicy,
} from "@honk/contracts";
import { getModelOptionBooleanSelectionValue } from "./model";

export const CURSOR_PROVIDER_ID = "cursor";
export const CURSOR_COMPOSER_MODEL_ID = "composer-2-5";
export const CURSOR_COMPOSER_MODEL_NAME = "Composer 2.5";
export const CURSOR_COMPOSER_FAST_OPTION_ID = "fast";

const CURSOR_COMPOSER_POLICY_MODEL_ID = `${CURSOR_PROVIDER_ID}/${CURSOR_COMPOSER_MODEL_ID}`;

export function cursorComposerPolicyModelSelection(
  fastEnabled = false,
): Extract<AgentModelPolicy["modelSelection"], { type: "explicit" }> {
  return {
    type: "explicit",
    authProviderId: AuthProviderId.make(CURSOR_PROVIDER_ID),
    accountId: AccountId.make(`${CURSOR_PROVIDER_ID}:default`),
    modelId: ModelId.make(CURSOR_COMPOSER_POLICY_MODEL_ID),
    options: [
      {
        id: CURSOR_COMPOSER_FAST_OPTION_ID,
        value: fastEnabled,
      },
    ],
  };
}

export function cursorComposerFastEnabled(
  modelSelection: AgentModelPolicy["modelSelection"],
): boolean {
  if (
    modelSelection.type !== "explicit" ||
    modelSelection.authProviderId !== CURSOR_PROVIDER_ID ||
    modelSelection.modelId !== CURSOR_COMPOSER_POLICY_MODEL_ID
  ) {
    return false;
  }
  return (
    getModelOptionBooleanSelectionValue(
      modelSelection.options,
      CURSOR_COMPOSER_FAST_OPTION_ID,
    ) ?? false
  );
}
