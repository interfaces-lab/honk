import type { SubagentToolDetails, TurnId } from "@honk/contracts";
import {
  DEFAULT_SUBAGENT_BUDGET_LIMITS,
  truncateSubagentOutputForParent,
} from "./subagent-budget";

export const BACKGROUND_SUBAGENT_COMPLETION_DEBOUNCE_MS = 200;

export interface BackgroundSubagentCompletion {
  readonly details: SubagentToolDetails;
  readonly isError: boolean;
  readonly notificationText: string | null;
}

export interface BackgroundSubagentRegistration {
  readonly toolCallId: string;
  readonly turnId: TurnId | null;
  readonly currentDetails: () => SubagentToolDetails;
  readonly currentLiveDetails: () => SubagentToolDetails;
  readonly summarize: (details: SubagentToolDetails) => string;
  readonly abort: () => void;
  readonly completion: Promise<BackgroundSubagentCompletion>;
}

export interface BackgroundSubagentController {
  readonly canRunBackgroundSubagent: () => boolean;
  readonly activeBackgroundSubagentTurnId: () => TurnId | null;
  readonly registerBackgroundSubagent: (registration: BackgroundSubagentRegistration) => void;
  readonly emitBackgroundSubagentUpdate: (toolCallId: string) => void;
}

export function buildBackgroundSubagentCompletionMessage(
  notifications: readonly string[],
): string {
  const cappedNotifications = notifications.map((notification) =>
    truncateSubagentOutputForParent({
      text: notification,
      maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerRun,
    }),
  );
  return truncateSubagentOutputForParent({
    text: [
      "<system_reminder>",
      "Do not quote this notification to the user unless asked. Use it to update your coordination state.",
      "</system_reminder>",
      cappedNotifications.join("\n\n"),
    ].join("\n"),
    maxBytes: DEFAULT_SUBAGENT_BUDGET_LIMITS.maxParentVisibleOutputBytesPerToolCall,
  });
}

const controllersBySessionId = new Map<string, BackgroundSubagentController>();

export function registerBackgroundSubagentController(
  sessionId: string,
  controller: BackgroundSubagentController,
): () => void {
  controllersBySessionId.set(sessionId, controller);
  return () => {
    if (controllersBySessionId.get(sessionId) === controller) {
      controllersBySessionId.delete(sessionId);
    }
  };
}

export function backgroundSubagentControllerForSession(
  sessionId: string,
): BackgroundSubagentController | null {
  return controllersBySessionId.get(sessionId) ?? null;
}
