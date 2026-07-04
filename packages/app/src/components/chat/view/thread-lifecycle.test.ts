import { EnvironmentId } from "@honk/shared/environment";
import {
  MessageId,
  TurnId,
} from "@honk/shared/base-schemas";
import { ProjectId, ThreadId } from "@honk/shared/base-schemas";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ChatMessage,
  type Thread,
} from "../../../types";
import { DraftId } from "../../../stores/chat-drafts";
import {
  buildLocalDraftThread,
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
    ...input,
  };
}

describe("buildLocalDraftThread", () => {
  it("labels new draft shells as New Agent", () => {
    const draftThread = buildLocalDraftThread(
      threadId,
      {
        branch: null,
        createdAt,
        environmentId,
        envMode: "local",
        interactionMode: DEFAULT_INTERACTION_MODE,
        logicalProjectKey: "project:logical",
        projectId,
        threadId,
        updatedAt: createdAt,
        worktreePath: null,
      },
      {
        instanceId: "codex",
        model: "gpt-5.5",
      },
      null,
    );

    expect(draftThread.title).toBe("New Agent");
  });
});

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

  it("treats committed user text as renderable", () => {
    expect(
      threadHasRenderableUserStart(
        thread({
          messages: [userMessage()],
        }),
      ),
    ).toBe(true);
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

  it("does not resolve same-id server fallback without an explicit promotion", () => {
    expect(
      resolveRenderableDraftCanonicalThreadRef({
        promotedTo: null,
        serverThread: thread({
          messages: [userMessage()],
        }),
      }),
    ).toBeNull();
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

  it("keeps local dispatch when the session updates before a changed turn is visible", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: null,
        session: {
          status: "running",
          orchestrationStatus: "idle",
          createdAt,
          updatedAt: startedAt,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges local dispatch once the session is visibly starting", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: null,
        session: {
          status: "running",
          orchestrationStatus: "starting",
          createdAt,
          updatedAt: startedAt,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
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

  it("acknowledges local dispatch when a settled errored turn left thread.error set", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          turnId,
          state: "error",
          requestedAt: createdAt,
          startedAt,
          completedAt,
          assistantMessageId: null,
        },
        session: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: "Turn failed",
      }),
    ).toBe(true);
  });

  it("does not acknowledge local dispatch for thread.error without a settled errored turn", () => {
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: null,
        session: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: "Turn failed",
      }),
    ).toBe(false);
  });
});
