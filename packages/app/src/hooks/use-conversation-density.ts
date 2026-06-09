import type { ConversationDensity } from "@multi/contracts/settings";
import { useSettings } from "./use-settings";

export function useConversationDensity(): ConversationDensity {
  return useSettings((settings) => settings.conversationDensity);
}
