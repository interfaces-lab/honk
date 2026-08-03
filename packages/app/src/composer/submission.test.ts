import { describe, expect, it, vi } from "vitest";

import {
  classifyPromptCommand,
  expandPromptCommandTemplate,
  formatInlineContextDataUrl,
  formatSkillReference,
  hasSubmittablePrompt,
  inlineContextKindFromDataUrl,
  ownsThreadComposerQueue,
  shouldQueueThreadPrompt,
  splitSkillReferences,
  waitForPendingReads,
} from "./submission";

describe("prompt submission", () => {
  it("allows attachment-only prompts", () => {
    expect(hasSubmittablePrompt("", 1)).toBe(true);
    expect(hasSubmittablePrompt("   ", 0)).toBe(false);
  });

  it("gives only the parentless main agent a local queue", () => {
    expect(ownsThreadComposerQueue(null)).toBe(true);
    expect(ownsThreadComposerQueue("parent-session")).toBe(false);
    expect(ownsThreadComposerQueue("nested-parent-session")).toBe(false);
  });

  it("queues normal main-agent submissions and sends every other submission directly", () => {
    expect(shouldQueueThreadPrompt({ ownsQueue: true, sendNow: false })).toBe(true);
    expect(shouldQueueThreadPrompt({ ownsQueue: true, sendNow: true })).toBe(false);
    expect(shouldQueueThreadPrompt({ ownsQueue: false, sendNow: false })).toBe(false);
    expect(shouldQueueThreadPrompt({ ownsQueue: false, sendNow: true })).toBe(false);
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

  it("expands raw and positional command arguments", () => {
    expect(expandPromptCommandTemplate("Create $1 in $2 with $3", 'button src "hello world"')).toBe(
      "Create button in src with hello world",
    );
    expect(expandPromptCommandTemplate("Review $ARGUMENTS", "src/app.ts carefully")).toBe(
      "Review src/app.ts carefully",
    );
  });

  it("appends arguments a template never references instead of dropping them", () => {
    expect(expandPromptCommandTemplate("Do the thing", "with this context")).toBe(
      "Do the thing\n\nwith this context",
    );
    expect(expandPromptCommandTemplate("Do the thing", "")).toBe("Do the thing");
  });

  it("splits skill references into chip and text segments", () => {
    expect(formatSkillReference("poteto", "~/.claude/skills/poteto/SKILL.md")).toBe(
      "[poteto][~/.claude/skills/poteto/SKILL.md]",
    );
    expect(
      splitSkillReferences("[poteto][~/.claude/skills/poteto/SKILL.md] where is the display"),
    ).toEqual([
      { type: "skill", name: "poteto", path: "~/.claude/skills/poteto/SKILL.md", offset: 0 },
      { type: "text", value: " where is the display", offset: 42 },
    ]);
    // A markdown reference link has no slash in its second bracket, so it stays plain text.
    expect(splitSkillReferences("see [the docs][ref] here")).toEqual([
      { type: "text", value: "see [the docs][ref] here", offset: 0 },
    ]);
  });

  it("tags generated context files without changing their text media type", () => {
    const chat = formatInlineContextDataUrl("chat", "user: hello");
    const branch = formatInlineContextDataUrl("branch", "diff --git");

    expect(chat).toBe("data:text/plain;honk-context=chat;charset=utf-8,user%3A%20hello");
    expect(inlineContextKindFromDataUrl(chat)).toBe("chat");
    expect(inlineContextKindFromDataUrl(branch)).toBe("branch");
    expect(inlineContextKindFromDataUrl("data:text/plain,ordinary")).toBeNull();
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
