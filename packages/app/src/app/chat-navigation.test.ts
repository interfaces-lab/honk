import { EnvironmentId, ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { scopeThreadRef } from "~/lib/environment-scope";
import { DraftId } from "~/stores/chat-drafts";
import { openChatIndex, openDraft, openThread } from "./chat-navigation";

const environmentId = EnvironmentId.make("environment:test");
const threadId = ThreadId.make("thread:test");
const draftId = DraftId.make("draft:test");

describe("chat navigation", () => {
  it("opens server thread routes with branded params", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openThread(navigate, scopeThreadRef(environmentId, threadId), { replace: true });

    expect(calls).toEqual([
      {
        to: "/$environmentId/$threadId",
        params: {
          environmentId,
          threadId,
        },
        replace: true,
      },
    ]);
  });

  it("opens draft routes with branded params", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openDraft(navigate, draftId);

    expect(calls).toEqual([
      {
        to: "/draft/$draftId",
        params: {
          draftId,
        },
      },
    ]);
  });

  it("opens the chat index with replace when requested", () => {
    const calls: unknown[] = [];
    const navigate = (options: unknown) => {
      calls.push(options);
    };

    openChatIndex(navigate, { replace: true });

    expect(calls).toEqual([
      {
        to: "/",
        replace: true,
      },
    ]);
  });
});
