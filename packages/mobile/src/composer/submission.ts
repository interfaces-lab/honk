import type { OpenCodeSessionRef } from "@honk/opencode";

import {
  enqueueThreadMessage,
  readThreadQueue,
  shiftThreadMessage,
  unshiftThreadMessage,
  type QueueInput,
  type QueueItem,
} from "./queue-store";

/**
 * Everything the drain needs that changes between renders. The controller itself only owns the
 * mutable flags, so the screen can recreate this object freely without losing single-flight state.
 *
 * `dispatch` resolves `true` when the message reached the session and `false` when it did not; it
 * must not reject. A rejection is treated as a failed send.
 */
export interface QueueDrainContext {
  readonly ref: OpenCodeSessionRef;
  readonly running: boolean;
  readonly dispatch: (item: QueueItem) => Promise<boolean>;
}

export interface ComposerQueueDrain {
  /** True while a queued message is in flight. */
  readonly isDispatching: () => boolean;
  /**
   * The single enqueue action. The message always joins the queue; an idle session drains it
   * straight away so the control still feels like a plain send.
   */
  readonly submit: (context: QueueDrainContext, input: QueueInput) => Promise<void>;
  /**
   * Call on every change to the session's running flag. Draining happens on the running → idle
   * edge, which is the moment the agent can accept the next turn.
   */
  readonly syncRunning: (context: QueueDrainContext) => Promise<void>;
  /** A user stop must not fire the next queued message at the agent. Skips exactly one drain. */
  readonly suppressNextDrain: () => void;
}

export function createComposerQueueDrain(): ComposerQueueDrain {
  let dispatching = false;
  let suppressed = false;
  let wasRunning = false;
  let missedEdge = false;

  const drain = async (context: QueueDrainContext): Promise<void> => {
    if (dispatching) return;
    const head = readThreadQueue(context.ref)[0];
    if (head === undefined) return;
    shiftThreadMessage(context.ref);
    dispatching = true;
    missedEdge = false;
    const sent = await context.dispatch(head).catch(() => false);
    dispatching = false;
    // A failed send stays visible at the head of the tray instead of vanishing with the failure.
    // Nothing retries it automatically; the next idle edge or the next submit picks it up.
    if (!sent) {
      missedEdge = false;
      unshiftThreadMessage(context.ref, head);
      return;
    }
    if (missedEdge) {
      missedEdge = false;
      await drain(context);
    }
  };

  return {
    isDispatching: () => dispatching,

    submit: async (context, input) => {
      enqueueThreadMessage(context.ref, input);
      if (context.running) return;
      await drain(context);
    },

    syncRunning: async (context) => {
      const ended = wasRunning && !context.running;
      wasRunning = context.running;
      if (!ended) return;
      if (suppressed) {
        suppressed = false;
        return;
      }
      // The screen reconciles a send by reloading the session, so a fast turn can report idle again
      // before the dispatch promise settles. Remember that edge or the rest of the queue stalls
      // until the user submits again.
      if (dispatching) {
        missedEdge = true;
        return;
      }
      await drain(context);
    },

    suppressNextDrain: () => {
      suppressed = true;
    },
  };
}
