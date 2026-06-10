import type { ConversationDensity } from "@multi/contracts/settings";
import { normalizeConversationDensity } from "@multi/shared/conversation-density";
import { useSettings } from "./use-settings";

export function useConversationDensity(): ConversationDensity {
  return useSettings((settings) => normalizeConversationDensity(settings.conversationDensity));
}
