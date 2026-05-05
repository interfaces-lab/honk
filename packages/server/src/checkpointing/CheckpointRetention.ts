export interface CheckpointRetainedTurn {
  readonly turnId: string | null;
  readonly checkpointTurnCount: number | null;
}

export function getCheckpointRetainedTurnIds(
  turns: ReadonlyArray<CheckpointRetainedTurn>,
  turnCount: number,
): ReadonlySet<string> {
  return new Set(
    turns
      .filter(
        (turn) =>
          turn.turnId !== null &&
          turn.checkpointTurnCount !== null &&
          turn.checkpointTurnCount <= turnCount,
      )
      .flatMap((turn) => (turn.turnId === null ? [] : [turn.turnId])),
  );
}

export function retainMessagesAfterCheckpointRevert<
  Message extends {
    readonly role: string;
    readonly turnId: string | null;
    readonly createdAt: string;
  },
>(input: {
  readonly messages: ReadonlyArray<Message>;
  readonly retainedTurnIds: ReadonlySet<string>;
  readonly turnCount: number;
  readonly messageId: (message: Message) => string;
  readonly retainedMessageIds?: ReadonlySet<string>;
}): ReadonlyArray<Message> {
  const retainedMessageIds = new Set(input.retainedMessageIds ?? []);
  for (const message of input.messages) {
    const messageId = input.messageId(message);
    if (message.role === "system") {
      retainedMessageIds.add(messageId);
      continue;
    }
    if (message.turnId !== null && input.retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(messageId);
    }
  }

  const retainedUserCount = input.messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(input.messageId(message)),
  ).length;
  const missingUserCount = Math.max(0, input.turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = input.messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(input.messageId(message)) &&
          (message.turnId === null || input.retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          input.messageId(left).localeCompare(input.messageId(right)),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(input.messageId(message));
    }
  }

  const retainedAssistantCount = input.messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(input.messageId(message)),
  ).length;
  const missingAssistantCount = Math.max(0, input.turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = input.messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(input.messageId(message)) &&
          (message.turnId === null || input.retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          input.messageId(left).localeCompare(input.messageId(right)),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(input.messageId(message));
    }
  }

  return input.messages.filter((message) => retainedMessageIds.has(input.messageId(message)));
}

export function retainTurnFactsAfterCheckpointRevert<
  Fact extends { readonly turnId: string | null },
>(facts: ReadonlyArray<Fact>, retainedTurnIds: ReadonlySet<string>): ReadonlyArray<Fact> {
  return facts.filter((fact) => fact.turnId === null || retainedTurnIds.has(fact.turnId));
}
