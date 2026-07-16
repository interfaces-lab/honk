import type { ComposerCommand } from "../open-code-view";
import type { PromptCommand } from "./types";

export function hasSubmittablePrompt(text: string, fileCount: number): boolean {
  return text.trim().length > 0 || fileCount > 0;
}

export function classifyPromptCommand(input: {
  readonly text: string;
  readonly fileCount: number;
  readonly localCommands: readonly Pick<ComposerCommand, "name">[];
  readonly serverCommands: readonly Pick<ComposerCommand, "name">[];
}): PromptCommand | null {
  if (input.fileCount > 0) {
    return null;
  }
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.text.trim());
  if (match === null) {
    return null;
  }
  const name = match[1] ?? "";
  const known = [...input.localCommands, ...input.serverCommands].some(
    (command) => command.name === name,
  );
  return known ? { name, arguments: (match[2] ?? "").trim() } : null;
}

export function waitForPendingReads(
  pending: readonly Promise<unknown>[],
  onSettled: () => void,
): boolean {
  if (pending.length === 0) {
    return false;
  }
  void Promise.allSettled(pending).then(() => {
    onSettled();
  });
  return true;
}
