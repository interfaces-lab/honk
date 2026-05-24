import type { ProviderConversationMessage, ProviderSendTurnInput } from "@multi/contracts";

function formatConversationRole(role: ProviderConversationMessage["role"]): string {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    case "user":
      return "User";
  }
}

export function formatProviderTurnInputText(input: ProviderSendTurnInput): string | undefined {
  const currentInput = input.input?.trim() ?? "";
  const context = (input.context ?? [])
    .map((message) => {
      const text = message.text.trim();
      return text.length > 0 ? `${formatConversationRole(message.role)}:\n${text}` : null;
    })
    .filter((message): message is string => message !== null);

  if (context.length === 0) {
    return currentInput.length > 0 ? currentInput : undefined;
  }

  const contextText = ["Conversation context for the selected branch:", context.join("\n\n")].join(
    "\n\n",
  );

  if (currentInput.length === 0) {
    return contextText;
  }

  return [contextText, "Current user message:", currentInput].join("\n\n");
}
