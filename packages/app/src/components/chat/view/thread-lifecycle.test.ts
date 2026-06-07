import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadEntryId,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatMessage,
  type Thread,
} from "../../../types";
import { DraftId } from "../../../stores/chat-drafts";
import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  resolveDraftPromotionRouteTarget,
  resolveRenderableDraftCanonicalThreadRef,
  threadHasRenderableUserStart,
} from "./thread-lifecycle";

const environmentId = EnvironmentId.make("environment:thread-lifecycle");
const threadId = ThreadId.make("thread:thread-lifecycle");
const projectId = ProjectId.make("project:thread-lifecycle");
const turnId = TurnId.make("turn:thread-lifecycle");
const createdAt = "2026-06-06T00:00:00.000Z";
const startedAt = "2026-06-06T00:00:01.000Z";
const completedAt = "2026-06-06T00:00:02.000Z";

function userMessage(input: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: MessageId.make("message:user"),
    role: "user",
    text: "Commit and push",
    createdAt,
    streaming: false,
    ...input,
  };
}

function userMessageTimelineRow(messageId = MessageId.make("message:user")) {
  return {
    id: "row:user",
    kind: "message" as const,
    orderKey: `${createdAt}:row:user`,
    createdAt,
    messageId,
    turnId: null,
    entryId: ThreadEntryId.make("thread-entry:user"),
  };
}

function thread(input: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    codexThreadId: null,
    projectId,
    title: "Thread",
    modelSelection: {
      instanceId: "codex",
      model: "gpt-5.5",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    leafId: null,
    entries: [],
    proposedPlans: [],
    error: null,
    createdAt,
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    chatTimelineRows: [],
    ...input,
  };
}

describe("threadHasRenderableUserStart", () => {
  it("does not treat an empty server thread as renderable", () => {
    expect(threadHasRenderableUserStart(thread())).toBe(false);
  });

  it("does not treat a blank user shell as renderable", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [userMessage({ text: "" })],
        }),
      ),
    ).toBe(false);
  });

  it("does not treat a rowless committed user text message as renderable", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [userMessage()],
        }),
      ),
    ).toBe(false);
  });

  it("treats an attachment-only user message as renderable", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [
            userMessage({
              text: "",
              attachments: [
                {
                  type: "image",
                  id: "image:1",
                  name: "screenshot.png",
                  mimeType: "image/png",
                  sizeBytes: 1024,
                },
              ],
            }),
          ],
          chatTimelineRows: [userMessageTimelineRow()],
        }),
      ),
    ).toBe(true);
  });

  it("waits when timeline rows exist but do not reference the user message", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [userMessage()],
          chatTimelineRows: [
            {
              id: "row:assistant",
              kind: "message",
              orderKey: `${createdAt}:row:assistant`,
              createdAt,
              messageId: MessageId.make("message:assistant"),
              turnId: null,
              entryId: ThreadEntryId.make("thread-entry:assistant"),
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("treats a timeline row that references the user message as renderable", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [userMessage()],
          chatTimelineRows: [userMessageTimelineRow()],
        }),
      ),
    ).toBe(true);
  });
});

describe("resolveRenderableDraftCanonicalThreadRef", () => {
  it("does not resolve a promoted draft before the server thread can render the user start", () => {
    expect(
      resolveRenderableDraftCanonicalThreadRef({
        promotedTo: {
          environmentId,
          threadId,
        },
        serverThread: thread({
          messages: [userMessage({ text: "" })],
        }),
      }),
    ).toBeNull();
  });

  it("resolves promoted drafts once the server thread can render the user start", () => {
    const promotedTo = {
      environmentId,
      threadId,
    };

    expect(
      resolveRenderableDraftCanonicalThreadRef({
        promotedTo,
        serverThread: thread({
          messages: [userMessage()],
          chatTimelineRows: [userMessageTimelineRow()],
        }),
      }),
    ).toEqual(promotedTo);
  });

  it("does not resolve same-id server fallback before the user start is renderable", () => {
    expect(
      resolveRenderableDraftCanonicalThreadRef({
        promotedTo: null,
        serverThread: thread(),
      }),
    ).toBeNull();
  });

  it("resolves same-id server fallback once the user start is renderable", () => {
    expect(
      resolveRenderableDraftCanonicalThreadRef({
        promotedTo: null,
        serverThread: thread({
          messages: [userMessage()],
          chatTimelineRows: [userMessageTimelineRow()],
        }),
      }),
    ).toEqual({
      environmentId,
      threadId,
    });
  });
});

describe("resolveDraftPromotionRouteTarget", () => {
  const draftId = DraftId.make("draft:thread-lifecycle");
  const serverThreadRef = {
    environmentId,
    threadId,
  };

  it("returns null before route params resolve", () => {
    expect(
      resolveDraftPromotionRouteTarget({
        draftRouteId: draftId,
        serverThread: thread(),
        serverThreadRef: null,
      }),
    ).toBeNull();
  });

  it("keeps a promoting draft targeted at the draft shell before server content is renderable", () => {
    expect(
      resolveDraftPromotionRouteTarget({
        draftRouteId: draftId,
        serverThread: thread({
          messages: [userMessage({ text: "" })],
        }),
        serverThreadRef,
      }),
    ).toEqual({
      kind: "draft",
      draftId,
    });
  });

  it("targets the server once the promoted thread can render the user start", () => {
    expect(
      resolveDraftPromotionRouteTarget({
        draftRouteId: draftId,
        serverThread: thread({
          messages: [userMessage()],
          chatTimelineRows: [userMessageTimelineRow()],
        }),
        serverThreadRef,
      }),
    ).toEqual({
      kind: "server",
      threadRef: serverThreadRef,
    });
  });

  it("keeps normal server routes targeted at the server", () => {
    expect(
      resolveDraftPromotionRouteTarget({
        draftRouteId: null,
        serverThread: thread(),
        serverThreadRef,
      }),
    ).toEqual({
      kind: "server",
      threadRef: serverThreadRef,
    });
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const localDispatch = createLocalDispatchSnapshot(thread());

  it("keeps local dispatch for a requested turn shell before runtime is visibly running", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: createdAt,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
        session: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges local dispatch once the changed turn is visibly running", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: createdAt,
          startedAt,
          completedAt: null,
          assistantMessageId: null,
        },
        session: {
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: turnId,
          createdAt,
          updatedAt: startedAt,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges local dispatch once the changed turn has settled", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          turnId,
          state: "completed",
          requestedAt: createdAt,
          startedAt,
          completedAt,
          assistantMessageId: MessageId.make("message:assistant"),
        },
        session: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });
});
