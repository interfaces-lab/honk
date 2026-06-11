import { EnvironmentId, ProjectId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { DraftId, useComposerDraftStore, type DraftThreadState } from "~/stores/chat-drafts";
import { DEFAULT_INTERACTION_MODE } from "~/types";
import {
  findDraftRouteMatch,
  resolvePreThreadServerRouteTarget,
  resolveDraftIdForRoute,
  resolveSidebarSelectionId,
  resolveThreadCopyId,
  resolveThreadRouteTarget,
} from "./-thread-route-targets";

const environmentId = EnvironmentId.make("environment:route-targets");
const projectId = ProjectId.make("project:route-targets");
const draftThreadId = ThreadId.make(
  `new-thread-draft:thread:project:${environmentId}:${projectId}`,
);
const draftId = DraftId.make(`new-thread-draft:project:${environmentId}:${projectId}`);
const serverThreadId = ThreadId.make("thread:route-targets:server");
const draftThreadRef = scopeThreadRef(environmentId, draftThreadId);
const serverThreadRef = scopeThreadRef(environmentId, serverThreadId);

function draftThreadState(input: Partial<DraftThreadState> = {}): DraftThreadState {
  const base: DraftThreadState = {
    threadId: draftThreadId,
    environmentId,
    projectId,
    logicalProjectKey: "git:/repo",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    envMode: "local",
    promotedTo: null,
  };
  return {
    ...base,
    ...input,
    updatedAt: input.updatedAt ?? base.updatedAt,
  };
}

describe("resolveThreadRouteTarget", () => {
  it("parses draft routes from draft params", () => {
    expect(
      resolveThreadRouteTarget({
        draftId,
      }),
    ).toEqual({
      kind: "draft",
      draftId,
    });
  });

  it("parses server routes from environment and thread params", () => {
    expect(
      resolveThreadRouteTarget({
        environmentId,
        threadId: draftThreadId,
      }),
    ).toEqual({
      kind: "server",
      threadRef: draftThreadRef,
    });
  });
});

describe("resolveDraftIdForRoute", () => {
  it("derives draft id from pre-thread url when draft store match is missing", () => {
    expect(
      resolveDraftIdForRoute({
        threadRef: draftThreadRef,
        draftRouteId: null,
      }),
    ).toBe(draftId);
  });
});

describe("findDraftRouteMatch", () => {
  it("matches draft sessions by pre-thread thread id", () => {
    const match = findDraftRouteMatch(
      {
        [draftId]: draftThreadState(),
      },
      draftThreadRef,
    );

    expect(match).toEqual({
      draftRouteId: draftId,
      draftThread: draftThreadState(),
    });
  });
});

describe("resolvePreThreadServerRouteTarget", () => {
  it("shows draft route for pre-thread server urls while the server thread is not renderable", () => {
    expect(
      resolvePreThreadServerRouteTarget({
        baseTarget: {
          kind: "server",
          threadRef: draftThreadRef,
        },
        draftRouteId: null,
        serverThread: undefined,
      }),
    ).toEqual({
      kind: "draft",
      draftId,
    });
  });

  it("keeps pre-thread server urls on the draft until the server thread is renderable", () => {
    expect(
      resolvePreThreadServerRouteTarget({
        baseTarget: {
          kind: "server",
          threadRef: draftThreadRef,
        },
        draftRouteId: draftId,
        serverThread: undefined,
      }),
    ).toEqual({
      kind: "draft",
      draftId,
    });
  });

  it("targets the server once the promoted thread can render the user start", () => {
    expect(
      resolvePreThreadServerRouteTarget({
        baseTarget: {
          kind: "server",
          threadRef: draftThreadRef,
        },
        draftRouteId: draftId,
        serverThread: {
          id: draftThreadId,
          environmentId,
          messages: [
            {
              id: "message:user" as never,
              role: "user",
              text: "hello",
              createdAt: "2026-06-08T00:00:00.000Z",
              streaming: false,
            },
          ],
        } as never,
      }),
    ).toEqual({
      kind: "server",
      threadRef: draftThreadRef,
    });
  });
});

describe("resolveSidebarSelectionId", () => {
  it("uses draft ids for draft routes", () => {
    expect(
      resolveSidebarSelectionId({
        kind: "draft",
        draftId,
      }),
    ).toBe(draftId);
  });

  it("uses server thread ids for server routes", () => {
    expect(
      resolveSidebarSelectionId({
        kind: "server",
        threadRef: serverThreadRef,
      }),
    ).toBe(serverThreadId);
  });
});

describe("resolveThreadCopyId", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    });
  });

  it("copies the promoted server thread id for pre-thread sidebar rows", () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadKey: {
        [draftId]: draftThreadState({
          promotedTo: serverThreadRef,
        }),
      },
    });

    expect(resolveThreadCopyId(draftThreadRef)).toBe(serverThreadId);
  });
});
