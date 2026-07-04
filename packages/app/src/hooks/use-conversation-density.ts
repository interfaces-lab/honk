import type { ConversationDensity } from "@honk/shared/conversation-density";
import { useSettings } from "./use-settings";

export function useConversationDensity(): ConversationDensity {
  return useSettings((settings) => settings.conversationDensity);
}
