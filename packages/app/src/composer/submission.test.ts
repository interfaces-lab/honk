import { describe, expect, it, vi } from "vitest";

import {
  classifyPromptCommand,
  hasSubmittablePrompt,
  waitForPendingReads,
} from "./submission";

describe("prompt submission", () => {
  it("allows attachment-only prompts", () => {
    expect(hasSubmittablePrompt("", 1)).toBe(true);
    expect(hasSubmittablePrompt("   ", 0)).toBe(false);
  });

  it("classifies only a leading known slash token without files", () => {
    const input = {
      fileCount: 0,
      localCommands: [{ name: "cd" }],
      serverCommands: [{ name: "review" }],
    } as const;

    expect(classifyPromptCommand({ ...input, text: "/cd packages/app" })).toEqual({
      name: "cd",
      arguments: "packages/app",
    });
    expect(classifyPromptCommand({ ...input, text: "/review" })).toEqual({
      name: "review",
      arguments: "",
    });
    expect(classifyPromptCommand({ ...input, text: "please /review" })).toBeNull();
    expect(classifyPromptCommand({ ...input, text: "/unknown" })).toBeNull();
    expect(classifyPromptCommand({ ...input, text: "/cd repo", fileCount: 1 })).toBeNull();
  });

  it("re-enters submission only after every pending file read settles", async () => {
    let resolveFirst: (() => void) | undefined;
    let rejectSecond: ((reason?: unknown) => void) | undefined;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((_resolve, reject) => {
      rejectSecond = reject;
    });
    const onSettled = vi.fn();

    expect(waitForPendingReads([first, second], onSettled)).toBe(true);
    resolveFirst?.();
    await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
    rejectSecond?.(new Error("unreadable"));
    await Promise.allSettled([first, second]);
    await Promise.resolve();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(waitForPendingReads([], onSettled)).toBe(false);
  });
});
