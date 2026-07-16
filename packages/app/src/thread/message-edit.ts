export async function runMessageEdit(input: {
  readonly messageID: string;
  readonly isRunning: boolean;
  readonly interrupt: () => Promise<void>;
  readonly revert: (messageID: string) => Promise<void>;
  readonly restore: () => Promise<void>;
  readonly send: () => Promise<void>;
}): Promise<void> {
  if (input.isRunning) await input.interrupt();
  await input.revert(input.messageID);
  try {
    await input.send();
  } catch (sendError) {
    try {
      await input.restore();
    } catch (restoreError) {
      throw new AggregateError(
        [sendError, restoreError],
        "The edit failed and the original turn could not be restored.",
      );
    }
    throw sendError;
  }
}
