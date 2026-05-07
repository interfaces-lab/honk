import { EnvironmentId, ThreadId, TurnId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import {
  resolveGitAgentInterruptTarget,
  resolvePendingGitAgentAction,
  type GitAgentRun,
} from "./git-agent-actions";

const ENV_ID = EnvironmentId.make("env-a");
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

const handoff: GitAgentRun = {
  action: "commitAndPush",
  target: { environmentId: ENV_ID, threadId: THREAD_ID },
};

const active: GitAgentRun = {
  action: "commit",
  target: { environmentId: ENV_ID, threadId: THREAD_ID, turnId: TURN_ID },
};

describe("resolvePendingGitAgentAction", () => {
  it("prefers the store-backed active run", () => {
    expect(
      resolvePendingGitAgentAction({
        activeRun: active,
        mutationIsPending: true,
        mutationVariables: "commitAndPush",
        orchestrationHandoff: handoff,
      }),
    ).toBe("commit");
  });

  it("uses mutation variables while pending", () => {
    expect(
      resolvePendingGitAgentAction({
        activeRun: null,
        mutationIsPending: true,
        mutationVariables: "commitAndPush",
        orchestrationHandoff: null,
      }),
    ).toBe("commitAndPush");
  });

  it("falls through to orchestration handoff after mutation settles", () => {
    expect(
      resolvePendingGitAgentAction({
        activeRun: null,
        mutationIsPending: false,
        mutationVariables: "commitAndPush",
        orchestrationHandoff: handoff,
      }),
    ).toBe("commitAndPush");
  });

  it("returns null when nothing is active", () => {
    expect(
      resolvePendingGitAgentAction({
        activeRun: null,
        mutationIsPending: false,
        mutationVariables: undefined,
        orchestrationHandoff: null,
      }),
    ).toBeNull();
  });
});

describe("resolveGitAgentInterruptTarget", () => {
  it("prefers the active run target", () => {
    expect(
      resolveGitAgentInterruptTarget({
        activeRun: active,
        orchestrationHandoff: handoff,
      }),
    ).toEqual(active.target);
  });

  it("uses handoff when store has not caught up", () => {
    expect(
      resolveGitAgentInterruptTarget({
        activeRun: null,
        orchestrationHandoff: handoff,
      }),
    ).toEqual(handoff.target);
  });

  it("returns null when neither is set", () => {
    expect(
      resolveGitAgentInterruptTarget({
        activeRun: null,
        orchestrationHandoff: null,
      }),
    ).toBeNull();
  });
});
