import { Schema } from "effect";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./base-schemas";

const OptionalTimeoutMs = Schema.optionalKey(
  Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(60_000)),
);

export const BrowserAutomationStatus = Schema.Struct({
  available: Schema.Boolean,
  visible: Schema.Boolean,
  tabId: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
});
export type BrowserAutomationStatus = typeof BrowserAutomationStatus.Type;

export const BrowserAutomationOpenInput = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  show: Schema.optionalKey(Schema.Boolean),
  reuseExistingTab: Schema.optionalKey(Schema.Boolean),
});
export type BrowserAutomationOpenInput = typeof BrowserAutomationOpenInput.Type;

export const BrowserAutomationNavigateInput = Schema.Struct({
  url: Schema.String,
  readiness: Schema.optionalKey(Schema.Literals(["load", "domContentLoaded", "none"])),
  timeoutMs: OptionalTimeoutMs,
});
export type BrowserAutomationNavigateInput = typeof BrowserAutomationNavigateInput.Type;

const BrowserAutomationLocatorTarget = {
  selector: Schema.optionalKey(Schema.String),
  locator: Schema.optionalKey(Schema.String),
} as const;

export const BrowserAutomationClickInput = Schema.Struct({
  ...BrowserAutomationLocatorTarget,
  x: Schema.optionalKey(Schema.Number),
  y: Schema.optionalKey(Schema.Number),
  timeoutMs: OptionalTimeoutMs,
});
export type BrowserAutomationClickInput = typeof BrowserAutomationClickInput.Type;

export const BrowserAutomationTypeInput = Schema.Struct({
  ...BrowserAutomationLocatorTarget,
  text: Schema.String,
  clear: Schema.optionalKey(Schema.Boolean),
  timeoutMs: OptionalTimeoutMs,
});
export type BrowserAutomationTypeInput = typeof BrowserAutomationTypeInput.Type;

export const BrowserAutomationPressInput = Schema.Struct({
  key: Schema.String,
  modifiers: Schema.optionalKey(Schema.Array(Schema.Literals(["Alt", "Control", "Meta", "Shift"]))),
});
export type BrowserAutomationPressInput = typeof BrowserAutomationPressInput.Type;

export const BrowserAutomationScrollInput = Schema.Struct({
  ...BrowserAutomationLocatorTarget,
  deltaX: Schema.optionalKey(Schema.Number),
  deltaY: Schema.optionalKey(Schema.Number),
});
export type BrowserAutomationScrollInput = typeof BrowserAutomationScrollInput.Type;

export const BrowserAutomationEvaluateInput = Schema.Struct({
  expression: Schema.String,
  awaitPromise: Schema.optionalKey(Schema.Boolean),
});
export type BrowserAutomationEvaluateInput = typeof BrowserAutomationEvaluateInput.Type;

export const BrowserAutomationWaitForInput = Schema.Struct({
  ...BrowserAutomationLocatorTarget,
  text: Schema.optionalKey(Schema.String),
  urlIncludes: Schema.optionalKey(Schema.String),
  timeoutMs: OptionalTimeoutMs,
});
export type BrowserAutomationWaitForInput = typeof BrowserAutomationWaitForInput.Type;

export const BrowserAutomationElement = Schema.Struct({
  tag: Schema.String,
  role: Schema.NullOr(Schema.String),
  name: Schema.String,
  selector: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type BrowserAutomationElement = typeof BrowserAutomationElement.Type;

export const BrowserAutomationSnapshot = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  visibleText: Schema.String,
  interactiveElements: Schema.Array(BrowserAutomationElement),
  accessibilityTree: Schema.Unknown,
  consoleEntries: Schema.Array(
    Schema.Struct({
      level: Schema.String,
      text: Schema.String,
      timestamp: Schema.String,
    }),
  ),
  networkEntries: Schema.Array(Schema.Unknown),
  screenshot: Schema.Struct({
    mimeType: Schema.Literal("image/png"),
    data: Schema.String,
    width: Schema.Number,
    height: Schema.Number,
  }),
});
export type BrowserAutomationSnapshot = typeof BrowserAutomationSnapshot.Type;

export const BrowserAutomationRegisterInput = Schema.Struct({
  webContentsId: Schema.Int,
  workspaceKey: TrimmedNonEmptyString,
  browserId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
  threadId: ThreadId,
  environmentId: Schema.optionalKey(EnvironmentId),
  active: Schema.Boolean,
  visible: Schema.Boolean,
});
export type BrowserAutomationRegisterInput = typeof BrowserAutomationRegisterInput.Type;

export const BrowserAutomationUnregisterInput = Schema.Struct({
  webContentsId: Schema.Int,
});
export type BrowserAutomationUnregisterInput = typeof BrowserAutomationUnregisterInput.Type;

export const BrowserAutomationOpenRequest = Schema.Struct({
  threadId: ThreadId,
  url: Schema.optionalKey(Schema.String),
  show: Schema.optionalKey(Schema.Boolean),
  reuseExistingTab: Schema.optionalKey(Schema.Boolean),
});
export type BrowserAutomationOpenRequest = typeof BrowserAutomationOpenRequest.Type;

export interface BrowserAutomationController {
  status(threadId: ThreadId): Promise<BrowserAutomationStatus>;
  open(threadId: ThreadId, input: BrowserAutomationOpenInput): Promise<BrowserAutomationStatus>;
  navigate(
    threadId: ThreadId,
    input: BrowserAutomationNavigateInput,
  ): Promise<BrowserAutomationStatus>;
  snapshot(threadId: ThreadId): Promise<BrowserAutomationSnapshot>;
  click(threadId: ThreadId, input: BrowserAutomationClickInput): Promise<void>;
  type(threadId: ThreadId, input: BrowserAutomationTypeInput): Promise<void>;
  press(threadId: ThreadId, input: BrowserAutomationPressInput): Promise<void>;
  scroll(threadId: ThreadId, input: BrowserAutomationScrollInput): Promise<void>;
  evaluate(threadId: ThreadId, input: BrowserAutomationEvaluateInput): Promise<unknown>;
  waitFor(threadId: ThreadId, input: BrowserAutomationWaitForInput): Promise<void>;
}
