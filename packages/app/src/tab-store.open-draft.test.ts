import {
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeServerKey,
} from "@honk/opencode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  resolveLocation: vi.fn(),
  resolvePath: vi.fn(() => Promise.resolve({ home: "/Users/me" })),
  sessions: {
    create: vi.fn(),
    prompt: vi.fn(),
  },
  server: {
    key: "http://127.0.0.1:4096",
    origin: "http://127.0.0.1:4096",
    label: "OpenCode",
    kind: "local" as const,
  },
}));

vi.mock("./app-settings-store", () => ({
  getSnapshot: () => ({ defaultProjectDirectory: null }),
}));

vi.mock("./watch-registry", () => ({
  getBoundOpenCodeClient: () => harness,
  getOpenCodeClient: () => harness,
  noteOpenCodeSessionPromptAccepted: () => {},
  subscribeOpenCodeServers: () => () => {},
  subscribeSessionWatch: () => () => {},
}));

import { actions, getSnapshot } from "./tab-store";

describe("new session drafts", () => {
  beforeEach(() => {
    harness.resolveLocation.mockReset();
    harness.resolveLocation.mockResolvedValue({
      directory: "/Users/me/Developer/honk",
      project: { id: "project-honk", directory: "/Users/me/Developer/honk" },
    });
    harness.sessions.create.mockReset();
    harness.sessions.prompt.mockReset();
  });

  it("opens workspace and active-tab drafts without a location request", () => {
    actions.openDraft({
      server: harness.server.key as OpenCodeServerKey,
      directory: "/Users/me/Developer/honk",
    });

    expect(getSnapshot().tabs.at(-1)).toMatchObject({
      title: "New session",
      path: "/Users/me/Developer/honk",
      status: "draft",
    });
    expect(getSnapshot().activeKey).toBe(getSnapshot().tabs.at(-1)?.key);
    expect(harness.resolveLocation).not.toHaveBeenCalled();

    actions.openNew();

    expect(getSnapshot().tabs.at(-1)).toMatchObject({
      title: "New session",
      path: "/Users/me/Developer/honk",
      status: "draft",
    });
    expect(getSnapshot().tabs).toHaveLength(3);
    expect(harness.resolveLocation).not.toHaveBeenCalled();
  });

  it("keeps a created session when its first prompt fails", async () => {
    actions.openDraft({
      server: harness.server.key as OpenCodeServerKey,
      directory: "/Users/me/Developer/honk",
    });
    const draftKey = getSnapshot().activeKey;
    harness.sessions.create.mockResolvedValue({
      id: "ses_failed_prompt",
      title: "New session",
      projectID: "project-honk",
      location: { directory: "/Users/me/Developer/honk" },
    });
    let rejectPrompt: ((error: Error) => void) | undefined;
    harness.sessions.prompt.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectPrompt = reject;
      }),
    );

    const submission = actions.submitNew(
      {
        prompt: "Keep this text",
        server: harness.server.key as OpenCodeServerKey,
        location: { directory: "/Users/me/Developer/honk" },
        target: { type: "local" },
      },
      { replaceDraftKey: draftKey },
    );

    await vi.waitFor(() => expect(harness.sessions.prompt).toHaveBeenCalledOnce());
    expect(getSnapshot().tabs.some((tab) => tab.key === draftKey)).toBe(false);
    expect(getSnapshot().activeKey).toBe(
      openCodeSessionKey(
        openCodeSessionRef(harness.server.key as OpenCodeServerKey, "ses_failed_prompt"),
      ),
    );

    expect(rejectPrompt).toBeTypeOf("function");
    rejectPrompt?.(new Error("Prompt was not accepted"));
    await expect(submission).resolves.toBe(true);
  });
});
