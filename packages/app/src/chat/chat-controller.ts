// Thin runtime glue for the chat surface: the events stream lifecycle and the
// authoritative reloads, feeding ChatEvents to the pure model. All timing
// rules live in chat-model.ts where they are tested.

import * as React from "react";

import type { Session } from "@honk/core/session";
import type { Workspace } from "@honk/core/workspace";

import { describeError, getHonkClient, requireHonkClient, useHonkCore } from "./client";
import type { ChatEvent, ChatState } from "./chat-model";
import { initialState, reduce } from "./chat-model";

export interface CoreChat {
  readonly state: ChatState;
  readonly prompt: (text: string) => Promise<void>;
  readonly steer: (text: string) => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface ModelChoice {
  readonly providerId: string;
  readonly modelId: string;
}

/**
 * Creates a session; the caller navigates to it. Model choice is per session
 * (spec/core.md section 11) and recorded in the transcript, so the thread page
 * needs no model state of its own.
 */
export async function createCoreSession(input: {
  readonly workspaceId: Workspace.WorkspaceId;
  readonly model: ModelChoice | null;
}): Promise<Session.SessionId> {
  const sdk = requireHonkClient();
  const { id } = await sdk.session.create({
    workspaceId: input.workspaceId,
    ...(input.model === null ? {} : { model: input.model }),
  });
  return id;
}

/**
 * Attaches to an existing session: events stream in, reloads repair.
 *
 * The one effect here owns a per-session subscription — a resource whose
 * lifetime is this component's, which is exactly what effects are for. All
 * connection state lives in the client store; all timing rules live in the
 * reducer.
 */
export function useCoreSession(sessionId: Session.SessionId): CoreChat {
  const [state, dispatch] = React.useReducer(reduce, initialState);
  const core = useHonkCore();
  const sdk = core.status === "ready" ? core.client : null;
  const coreStatus = core.status;

  React.useEffect(() => {
    let disposed = false;
    const emit = (event: ChatEvent) => {
      if (!disposed) dispatch(event);
    };
    if (sdk === null) {
      if (coreStatus === "unavailable") {
        emit({ type: "failed", message: "Honk Core is not available in this host." });
      }
      return;
    }

    // The watch owns every timing rule (spec/core.md section 9): one
    // authoritative read at attach, advisory events between, a repair read at
    // each commit point. The surface only maps frames to reducer events.
    const frames = sdk.session.watch({ sessionId })[Symbol.asyncIterator]();
    void (async () => {
      emit({ type: "attached", sessionId });
      try {
        for (let next = await frames.next(); next.done !== true; next = await frames.next()) {
          if (disposed) return;
          const frame = next.value;
          if (frame.type === "state") {
            emit({
              type: "state",
              entries: frame.entries,
              status: frame.status,
              turns: frame.turns,
            });
          } else {
            emit({ type: "event", event: frame.event });
          }
        }
        emit({ type: "stream_ended" });
      } catch (error) {
        emit({ type: "failed", message: describeError(error) });
      }
    })();

    return () => {
      disposed = true;
      void frames.return?.(undefined);
    };
  }, [sdk, coreStatus, sessionId]);

  const command = (
    run: (client: NonNullable<ReturnType<typeof getHonkClient>>) => Promise<unknown>,
  ): Promise<void> => {
    const client = getHonkClient();
    if (client === null) return Promise.resolve();
    return run(client).then(
      () => undefined,
      (error: unknown) => {
        dispatch({ type: "failed", message: describeError(error) });
        throw error;
      },
    );
  };

  return {
    state,
    prompt: (text) => {
      dispatch({ type: "prompted" });
      return command((client) => client.session.prompt({ sessionId, text }));
    },
    steer: (text) => command((client) => client.session.steer({ sessionId, text })),
    stop: () => command((client) => client.session.abort({ sessionId })),
  };
}
