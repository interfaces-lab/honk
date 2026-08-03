import * as Electron from "electron";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";
import type {
  BrowserAutomationClickInput,
  BrowserAutomationEvaluateInput,
  BrowserAutomationNavigateInput,
  BrowserAutomationOpenInput,
  BrowserAutomationOpenRequest,
  BrowserAutomationPressInput,
  BrowserAutomationRegisterInput,
  BrowserAutomationScrollInput,
  BrowserAutomationSnapshot,
  BrowserAutomationStatus,
  BrowserAutomationTypeInput,
  BrowserAutomationWaitForInput,
} from "@honk/shared/browser-automation";
import type { ThreadId } from "@honk/shared/base-schemas";

import * as ElectronWindow from "../electron/electron-window";
import * as IpcChannels from "../ipc/channels";
import { playwrightInjectedRuntimeInstallExpression } from "./playwright-injected-runtime";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_VISIBLE_TEXT_LENGTH = 16_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_SCREENSHOT_WIDTH = 1_200;
const DIAGNOSTIC_BUFFER_LIMIT = 200;

interface BrowserHostRecord extends BrowserAutomationRegisterInput {
  readonly focusedAt: number;
}

interface PointResult {
  readonly x: number;
  readonly y: number;
}

interface ErrorResult {
  readonly error: string;
}

interface PageSnapshotResult {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly visibleText: string;
  readonly interactiveElements: BrowserAutomationSnapshot["interactiveElements"];
}

interface CdpEvaluationResult {
  readonly result?: {
    readonly value?: unknown;
    readonly description?: string;
  };
  readonly exceptionDetails?: {
    readonly text?: string;
    readonly exception?: { readonly description?: string };
  };
}

interface BrowserConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly timestamp: string;
}

interface BrowserNetworkEntry {
  readonly type: "request" | "response" | "failure";
  readonly timestamp: string;
  readonly requestId?: string;
  readonly url?: string;
  readonly method?: string;
  readonly status?: number;
  readonly errorText?: string;
}

interface BrowserDiagnostics {
  readonly consoleEntries: BrowserConsoleEntry[];
  readonly networkEntries: BrowserNetworkEntry[];
}

interface BrowserControlSession {
  readonly webContentsId: number;
  readonly scope: Scope.Closeable;
  readonly semaphore: Semaphore.Semaphore;
  readonly onMessage: (
    event: Electron.Event,
    method: string,
    params: Record<string, unknown>,
  ) => void;
  readonly diagnostics: BrowserDiagnostics;
  diagnosticsEnabled: boolean;
}

interface BrowserOwner {
  readonly record: BrowserHostRecord;
  readonly contents: Electron.WebContents;
}

type SendCommand = (
  method: string,
  params?: Record<string, unknown>,
) => Effect.Effect<unknown, BrowserAutomationError>;

export class BrowserAutomationError extends Data.TaggedError("BrowserAutomationError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message() {
    return messageFromUnknown(this.cause);
  }
}

export interface DesktopBrowserAutomationShape {
  readonly register: (input: BrowserAutomationRegisterInput) => Effect.Effect<void>;
  readonly unregister: (input: { readonly webContentsId: number }) => Effect.Effect<void>;
  readonly status: (threadId: ThreadId) => Effect.Effect<BrowserAutomationStatus>;
  readonly open: (
    threadId: ThreadId,
    input: BrowserAutomationOpenInput,
  ) => Effect.Effect<BrowserAutomationStatus, BrowserAutomationError>;
  readonly navigate: (
    threadId: ThreadId,
    input: BrowserAutomationNavigateInput,
  ) => Effect.Effect<BrowserAutomationStatus, BrowserAutomationError>;
  readonly snapshot: (
    threadId: ThreadId,
  ) => Effect.Effect<BrowserAutomationSnapshot, BrowserAutomationError>;
  readonly click: (
    threadId: ThreadId,
    input: BrowserAutomationClickInput,
  ) => Effect.Effect<void, BrowserAutomationError>;
  readonly type: (
    threadId: ThreadId,
    input: BrowserAutomationTypeInput,
  ) => Effect.Effect<void, BrowserAutomationError>;
  readonly press: (
    threadId: ThreadId,
    input: BrowserAutomationPressInput,
  ) => Effect.Effect<void, BrowserAutomationError>;
  readonly scroll: (
    threadId: ThreadId,
    input: BrowserAutomationScrollInput,
  ) => Effect.Effect<void, BrowserAutomationError>;
  readonly evaluate: (
    threadId: ThreadId,
    input: BrowserAutomationEvaluateInput,
  ) => Effect.Effect<unknown, BrowserAutomationError>;
  readonly waitFor: (
    threadId: ThreadId,
    input: BrowserAutomationWaitForInput,
  ) => Effect.Effect<void, BrowserAutomationError>;
}

export class DesktopBrowserAutomation extends Context.Service<
  DesktopBrowserAutomation,
  DesktopBrowserAutomationShape
>()("honk/desktop/browser/BrowserAutomation") {}

function messageFromUnknown(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function browserAutomationError(operation: string, cause: unknown): BrowserAutomationError {
  return new BrowserAutomationError({ operation, cause });
}

function replaceMap<K, V>(
  map: ReadonlyMap<K, V>,
  update: (copy: Map<K, V>) => void,
): ReadonlyMap<K, V> {
  const copy = new Map(map);
  update(copy);
  return copy;
}

function attemptPromise<A>(
  operation: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, BrowserAutomationError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => browserAutomationError(operation, cause),
  });
}

function appendLimited<T>(items: T[], item: T): void {
  items.push(item);
  if (items.length > DIAGNOSTIC_BUFFER_LIMIT)
    items.splice(0, items.length - DIAGNOSTIC_BUFFER_LIMIT);
}

function isPointResult(value: unknown): value is PointResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "x") === "number" &&
    typeof Reflect.get(value, "y") === "number"
  );
}

function isErrorResult(value: unknown): value is ErrorResult {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "error") === "string"
  );
}

function isPageSnapshotResult(value: unknown): value is PageSnapshotResult {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "url") === "string" &&
    typeof Reflect.get(value, "title") === "string" &&
    typeof Reflect.get(value, "loading") === "boolean" &&
    typeof Reflect.get(value, "visibleText") === "string" &&
    Array.isArray(Reflect.get(value, "interactiveElements"))
  );
}

function timeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(60_000, Math.floor(value)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("URL is required.");
  try {
    const parsed = new URL(trimmed);
    if (["http:", "https:", "file:", "about:"].includes(parsed.protocol)) return trimmed;
  } catch {
    // Fall through to shortcuts.
  }
  if (trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function webContentsFor(record: BrowserHostRecord): Electron.WebContents | null {
  const contents = Electron.webContents.fromId(record.webContentsId);
  if (!contents || contents.isDestroyed()) return null;
  return contents;
}

function statusFor(
  record: BrowserHostRecord,
  contents: Electron.WebContents,
): BrowserAutomationStatus {
  return {
    available: true,
    visible: record.visible,
    tabId: record.tabId,
    url: contents.getURL() || null,
    title: contents.getTitle() || null,
    loading: contents.isLoading(),
  };
}

function unavailableStatus(): BrowserAutomationStatus {
  return {
    available: false,
    visible: false,
    tabId: null,
    url: null,
    title: null,
    loading: false,
  };
}

function locatorFor(
  input:
    | BrowserAutomationClickInput
    | BrowserAutomationTypeInput
    | BrowserAutomationScrollInput
    | BrowserAutomationWaitForInput,
): string | null {
  return input.locator ?? (input.selector ? `css=${input.selector}` : null);
}

function quoteJson(value: unknown): string {
  return JSON.stringify(value);
}

function cdpErrorMessage(result: CdpEvaluationResult): string | null {
  if (!result.exceptionDetails) return null;
  return (
    result.exceptionDetails.exception?.description ??
    result.exceptionDetails.text ??
    "JavaScript evaluation failed."
  );
}

function cdpModifiers(
  modifiers: readonly ("Alt" | "Control" | "Meta" | "Shift")[] | undefined,
): number {
  return (modifiers ?? []).reduce((mask, modifier) => {
    if (modifier === "Alt") return mask | 1;
    if (modifier === "Control") return mask | 2;
    if (modifier === "Meta") return mask | 4;
    if (modifier === "Shift") return mask | 8;
    return mask;
  }, 0);
}

function consoleTextFromParams(params: Record<string, unknown>): string {
  const args = params["args"];
  if (!Array.isArray(args)) {
    const type = params["type"];
    return typeof type === "string" ? type : "console";
  }
  return args
    .map((arg) => {
      if (typeof arg !== "object" || arg === null) return String(arg);
      const value = Reflect.get(arg, "value");
      if (value !== undefined) return typeof value === "string" ? value : JSON.stringify(value);
      return String(Reflect.get(arg, "description") ?? Reflect.get(arg, "type") ?? "");
    })
    .filter(Boolean)
    .join(" ");
}

function objectField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function networkEntryFromParams(
  method: string,
  params: Record<string, unknown>,
): BrowserNetworkEntry {
  const requestId = optionalString(params["requestId"]);
  const timestamp = new Date().toISOString();
  if (method === "Network.requestWillBeSent") {
    const request = params["request"];
    const url = optionalString(objectField(request, "url"));
    const requestMethod = optionalString(objectField(request, "method"));
    return {
      type: "request",
      timestamp,
      ...(requestId === undefined ? {} : { requestId }),
      ...(url === undefined ? {} : { url }),
      ...(requestMethod === undefined ? {} : { method: requestMethod }),
    };
  }
  if (method === "Network.responseReceived") {
    const response = params["response"];
    const url = optionalString(objectField(response, "url"));
    const status = objectField(response, "status");
    return {
      type: "response",
      timestamp,
      ...(requestId === undefined ? {} : { requestId }),
      ...(url === undefined ? {} : { url }),
      ...(typeof status === "number" ? { status } : {}),
    };
  }
  const errorText = optionalString(params["errorText"]);
  return {
    type: "failure",
    timestamp,
    ...(requestId === undefined ? {} : { requestId }),
    ...(errorText === undefined ? {} : { errorText }),
  };
}

function snapshotScript(): string {
  return `(() => {
    const selectorFor = (element) => {
      if (element.id) return "#" + CSS.escape(element.id);
      for (const attribute of ["data-testid", "name", "aria-label"]) {
        const value = element.getAttribute(attribute);
        if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const parent = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
        const base = current.tagName.toLowerCase();
        parts.unshift(siblings.length > 1 ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : base);
        current = parent;
      }
      return parts.join(" > ");
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const implicitRole = (element) => element.getAttribute("role") || (element.tagName.toLowerCase() === "button" ? "button" : element.tagName.toLowerCase() === "a" && element.hasAttribute("href") ? "link" : element.tagName.toLowerCase() === "input" || element.tagName.toLowerCase() === "textarea" ? "textbox" : element.tagName.toLowerCase() === "select" ? "combobox" : null);
    const elements = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,[role],[tabindex]"))
      .filter(visible)
      .slice(0, ${MAX_INTERACTIVE_ELEMENTS})
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: implicitRole(element),
          name: element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "",
          selector: selectorFor(element),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    return {
      url: location.href,
      title: document.title,
      loading: document.readyState !== "complete",
      visibleText: (document.body?.innerText || "").slice(0, ${MAX_VISIBLE_TEXT_LENGTH}),
      interactiveElements: elements,
    };
  })()`;
}

function resolvePointScript(locator: string): string {
  return `(() => {
    try {
      const injected = globalThis.__honkPlaywrightInjected;
      if (!injected) return { error: "Playwright selector runtime is not installed." };
      const parsed = injected.parseSelector(${quoteJson(locator)});
      const element = injected.querySelector(parsed, document, true);
      if (!element) return { error: "No element matches locator ${locator.replace(/`/g, "\\`")}." };
      const visible = injected.elementState(element, "visible");
      const enabled = injected.elementState(element, "enabled");
      if (!visible.matches || !enabled.matches) return { error: "Matched element is not visible or enabled." };
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    } catch (error) {
      return { error: String(error) };
    }
  })()`;
}

function focusTargetScript(input: BrowserAutomationTypeInput): string {
  const locator = locatorFor(input);
  return `(() => {
    try {
      const injected = globalThis.__honkPlaywrightInjected;
      if (!injected) return { error: "Playwright selector runtime is not installed." };
      const parsed = injected.parseSelector(${quoteJson(locator)});
      const element = injected.querySelector(parsed, document, true);
      if (!element) return { error: "No element matches locator ${String(locator).replace(/`/g, "\\`")}." };
      const visible = injected.elementState(element, "visible");
      const enabled = injected.elementState(element, "enabled");
      if (!visible.matches || !enabled.matches) return { error: "Matched element is not visible or enabled." };
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();
      if (${input.clear === true ? "true" : "false"} && "value" in element) {
        element.value = "";
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    } catch (error) {
      return { error: String(error) };
    }
  })()`;
}

function waitConditionScript(input: BrowserAutomationWaitForInput): string {
  const locator = locatorFor(input);
  return `(() => {
    try {
      if (${quoteJson(input.urlIncludes ?? null)} && !location.href.includes(${quoteJson(input.urlIncludes ?? "")})) return false;
      if (${quoteJson(input.text ?? null)} && !(document.body?.innerText || "").includes(${quoteJson(input.text ?? "")})) return false;
      const locator = ${quoteJson(locator)};
      if (locator) {
        const injected = globalThis.__honkPlaywrightInjected;
        if (!injected) return false;
        const parsed = injected.parseSelector(locator);
        const element = injected.querySelector(parsed, document, true);
        if (!element) return false;
        const visible = injected.elementState(element, "visible");
        if (!visible.matches) return false;
      }
      return true;
    } catch {
      return false;
    }
  })()`;
}

async function navigateWebContents(
  contents: Electron.WebContents,
  url: string,
  readiness: NonNullable<BrowserAutomationNavigateInput["readiness"]>,
  timeout: number,
): Promise<void> {
  if (readiness === "none") {
    void contents.loadURL(url).catch(() => undefined);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Browser navigation timed out after ${timeout}ms.`));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timeoutId);
      if (readiness === "domContentLoaded") {
        contents.off("dom-ready", onDone);
      } else {
        contents.off("did-finish-load", onDone);
      }
      contents.off("did-fail-load", onFail);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || errorCode === -3) return;
      cleanup();
      reject(new Error(errorDescription || `Browser navigation failed (${errorCode}).`));
    };
    if (readiness === "domContentLoaded") {
      contents.on("dom-ready", onDone);
    } else {
      contents.on("did-finish-load", onDone);
    }
    contents.on("did-fail-load", onFail);
    void contents.loadURL(url).catch((cause: unknown) => {
      cleanup();
      reject(cause);
    });
  });
}

const makeDesktopBrowserAutomation = Effect.fn("browserAutomation.make")(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const parentScope = yield* Scope.Scope;
  const hostsRef = yield* SynchronizedRef.make<ReadonlyMap<number, BrowserHostRecord>>(new Map());
  const controlSessionsRef = yield* SynchronizedRef.make<
    ReadonlyMap<number, BrowserControlSession>
  >(new Map());
  const playwrightInstallExpression = yield* Effect.cached(
    playwrightInjectedRuntimeInstallExpression().pipe(
      Effect.mapError((cause) => browserAutomationError("installPlaywrightRuntime", cause)),
    ),
  );

  const selectOwner = Effect.fn("browserAutomation.selectOwner")(function* (threadId: ThreadId) {
    const hosts = yield* SynchronizedRef.get(hostsRef);
    const candidates = [...hosts.values()]
      .filter((record) => record.threadId === threadId)
      .map((record) => ({ record, contents: webContentsFor(record) }))
      .filter((entry): entry is BrowserOwner => entry.contents !== null)
      .sort((left, right) => {
        const activeDelta = Number(right.record.active) - Number(left.record.active);
        if (activeDelta !== 0) return activeDelta;
        const visibleDelta = Number(right.record.visible) - Number(left.record.visible);
        if (visibleDelta !== 0) return visibleDelta;
        return right.record.focusedAt - left.record.focusedAt;
      });
    return candidates[0] ?? null;
  });

  const requireOwner = Effect.fn("browserAutomation.requireOwner")(function* (threadId: ThreadId) {
    const owner = yield* selectOwner(threadId);
    if (owner) return owner;
    return yield* browserAutomationError(
      "requireOwner",
      new Error("No Honk browser tab is attached to this thread. Call browser_open first."),
    );
  });

  const waitForOwner = Effect.fn("browserAutomation.waitForOwner")(function* (
    threadId: ThreadId,
    timeout: number,
  ) {
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      const owner = yield* selectOwner(threadId);
      if (owner) return owner;
      yield* Effect.promise(() => sleep(50));
    }
    return yield* browserAutomationError(
      "attach",
      new Error("Timed out waiting for the Honk browser to attach."),
    );
  });

  const evaluateWithDebugger = <T = unknown>(
    send: SendCommand,
    expression: string,
    returnByValue: boolean,
    awaitPromise = true,
  ): Effect.Effect<T, BrowserAutomationError> =>
    send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
    }).pipe(
      Effect.flatMap((rawResponse) => {
        const response = rawResponse as CdpEvaluationResult;
        const error = cdpErrorMessage(response);
        return error
          ? Effect.fail(browserAutomationError("evaluate", new Error(error)))
          : Effect.succeed(response.result?.value as T);
      }),
    );

  const ensurePlaywrightInjected = Effect.fn("browserAutomation.ensurePlaywrightInjected")(
    function* (send: SendCommand) {
      const installed = yield* evaluateWithDebugger<boolean>(
        send,
        "Boolean(globalThis.__honkPlaywrightInjected)",
        true,
      );
      if (installed) return;
      yield* evaluateWithDebugger(send, yield* playwrightInstallExpression, true);
    },
  );

  const resolvePoint = Effect.fn("browserAutomation.resolvePoint")(function* (
    send: SendCommand,
    input: BrowserAutomationClickInput | BrowserAutomationTypeInput | BrowserAutomationScrollInput,
  ) {
    const locator = locatorFor(input);
    if (!locator) {
      return yield* browserAutomationError(
        "resolvePoint",
        new Error("A selector, locator, or x/y coordinates are required."),
      );
    }
    yield* ensurePlaywrightInjected(send);
    const result = yield* evaluateWithDebugger(send, resolvePointScript(locator), true);
    if (isErrorResult(result)) {
      return yield* browserAutomationError("resolvePoint", new Error(result.error));
    }
    if (!isPointResult(result)) {
      return yield* browserAutomationError(
        "resolvePoint",
        new Error("Browser target did not resolve to a point."),
      );
    }
    return result;
  });

  const detachControlSession = Effect.fn("browserAutomation.detachControlSession")(function* (
    webContentsId: number,
  ) {
    const session = yield* SynchronizedRef.modify(controlSessionsRef, (sessions) => [
      sessions.get(webContentsId),
      replaceMap(sessions, (copy) => {
        copy.delete(webContentsId);
      }),
    ]);
    if (session) {
      yield* Scope.close(session.scope, Exit.void).pipe(Effect.ignore);
    }
  });

  const detachAllControlSessions = Effect.fn("browserAutomation.detachAllControlSessions")(
    function* () {
      const sessions = yield* SynchronizedRef.modify(controlSessionsRef, (current) => [
        [...current.values()],
        new Map<number, BrowserControlSession>(),
      ]);
      yield* Effect.forEach(
        sessions,
        (session) => Scope.close(session.scope, Exit.void).pipe(Effect.ignore),
        { discard: true },
      );
    },
  );

  const ensureControlSession = Effect.fn("browserAutomation.ensureControlSession")(function* (
    contents: Electron.WebContents,
  ) {
    return yield* SynchronizedRef.modifyEffect(controlSessionsRef, (sessions) => {
      const existing = sessions.get(contents.id);
      if (existing) return Effect.succeed([existing, sessions] as const);
      if (contents.isDevToolsOpened()) {
        return Effect.fail(
          browserAutomationError(
            "attachDebugger",
            new Error("Close browser DevTools before using agent browser control."),
          ),
        );
      }
      if (contents.debugger.isAttached()) {
        return Effect.fail(
          browserAutomationError(
            "attachDebugger",
            new Error("Browser control cannot attach because another debugger owns this page."),
          ),
        );
      }

      const createControlSession = Effect.fn("browserAutomation.createControlSession")(
        function* () {
          const scope = yield* Scope.fork(parentScope, "sequential");
          const semaphore = yield* Semaphore.make(1);
          const diagnostics: BrowserDiagnostics = { consoleEntries: [], networkEntries: [] };
          const onMessage: BrowserControlSession["onMessage"] = (_event, method, params) => {
            if (method === "Runtime.consoleAPICalled") {
              const level = params["type"];
              appendLimited(diagnostics.consoleEntries, {
                level: typeof level === "string" ? level : "log",
                text: consoleTextFromParams(params),
                timestamp: new Date().toISOString(),
              });
            }
            if (method === "Log.entryAdded") {
              const entry = Reflect.get(params, "entry");
              appendLimited(diagnostics.consoleEntries, {
                level: String(
                  typeof entry === "object" && entry !== null ? Reflect.get(entry, "level") : "log",
                ),
                text: String(
                  typeof entry === "object" && entry !== null ? Reflect.get(entry, "text") : "",
                ),
                timestamp: new Date().toISOString(),
              });
            }
            if (
              method === "Network.requestWillBeSent" ||
              method === "Network.responseReceived" ||
              method === "Network.loadingFailed"
            ) {
              appendLimited(diagnostics.networkEntries, networkEntryFromParams(method, params));
            }
          };

          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              contents.debugger.off("message", onMessage);
              if (!contents.isDestroyed() && contents.debugger.isAttached()) {
                contents.debugger.detach();
              }
            }).pipe(Effect.ignore),
          );

          yield* Effect.try({
            try: () => {
              contents.debugger.on("message", onMessage);
              contents.debugger.attach("1.3");
            },
            catch: (cause) => browserAutomationError("attachDebugger", cause),
          }).pipe(Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)));

          yield* Effect.tryPromise({
            try: () => contents.debugger.sendCommand("Runtime.enable"),
            catch: (cause) => browserAutomationError("Runtime.enable", cause),
          }).pipe(Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)));

          const session: BrowserControlSession = {
            webContentsId: contents.id,
            scope,
            semaphore,
            onMessage,
            diagnostics,
            diagnosticsEnabled: false,
          };
          return [
            session,
            replaceMap(sessions, (copy) => {
              copy.set(contents.id, session);
            }),
          ] as const;
        },
      );

      return createControlSession();
    });
  });

  const withControlSession = <A>(
    contents: Electron.WebContents,
    use: (
      send: SendCommand,
      session: BrowserControlSession,
    ) => Effect.Effect<A, BrowserAutomationError>,
  ): Effect.Effect<A, BrowserAutomationError> =>
    Effect.gen(function* () {
      const session = yield* ensureControlSession(contents);
      const send: SendCommand = (method, params) =>
        Effect.tryPromise({
          try: () => contents.debugger.sendCommand(method, params),
          catch: (cause) => browserAutomationError(method, cause),
        });
      return yield* session.semaphore.withPermit(use(send, session));
    });

  const register = Effect.fn("browserAutomation.register")(function* (
    input: BrowserAutomationRegisterInput,
  ) {
    const shouldDetachControl = yield* SynchronizedRef.modify(hostsRef, (hosts) => {
      const existing = hosts.get(input.webContentsId);
      return [
        existing?.visible === true && !input.visible,
        replaceMap(hosts, (copy) => {
          copy.set(input.webContentsId, {
            ...input,
            focusedAt: input.active ? Date.now() : (existing?.focusedAt ?? 0),
          });
        }),
      ] as const;
    });
    const contents = Electron.webContents.fromId(input.webContentsId);
    if (contents !== undefined && !contents.isDestroyed()) {
      contents.setBackgroundThrottling(true);
    }
    if (shouldDetachControl) yield* detachControlSession(input.webContentsId);
  });

  const unregister = Effect.fn("browserAutomation.unregister")(function* (input: {
    readonly webContentsId: number;
  }) {
    yield* SynchronizedRef.update(hostsRef, (hosts) =>
      replaceMap(hosts, (copy) => {
        copy.delete(input.webContentsId);
      }),
    );
    yield* detachControlSession(input.webContentsId);
  });

  const status = Effect.fn("browserAutomation.status")(function* (threadId: ThreadId) {
    const owner = yield* selectOwner(threadId);
    if (!owner) return unavailableStatus();
    return statusFor(owner.record, owner.contents);
  });

  const navigate = Effect.fn("browserAutomation.navigate")(function* (
    threadId: ThreadId,
    input: BrowserAutomationNavigateInput,
  ) {
    const owner = yield* requireOwner(threadId);
    const url = yield* Effect.try({
      try: () => normalizeBrowserUrl(input.url),
      catch: (cause) => browserAutomationError("normalizeUrl", cause),
    });
    yield* Effect.tryPromise({
      try: () =>
        navigateWebContents(
          owner.contents,
          url,
          input.readiness ?? "load",
          timeoutMs(input.timeoutMs),
        ),
      catch: (cause) => browserAutomationError("navigate", cause),
    });
    return statusFor(owner.record, owner.contents);
  });

  const open = Effect.fn("browserAutomation.open")(function* (
    threadId: ThreadId,
    input: BrowserAutomationOpenInput,
  ) {
    const inputUrl = input.url;
    const url = inputUrl
      ? yield* Effect.try({
          try: () => normalizeBrowserUrl(inputUrl),
          catch: (cause) => browserAutomationError("normalizeUrl", cause),
        })
      : null;
    const request: BrowserAutomationOpenRequest = {
      threadId,
      show: input.show ?? true,
      reuseExistingTab: input.reuseExistingTab ?? true,
    };
    yield* electronWindow.sendAll(IpcChannels.BROWSER_AUTOMATION_OPEN_CHANNEL, request);
    const owner = yield* waitForOwner(threadId, timeoutMs(undefined));
    if (url) {
      return yield* navigate(threadId, { url, readiness: "load" });
    }
    return statusFor(owner.record, owner.contents);
  });

  const snapshot = Effect.fn("browserAutomation.snapshot")(function* (threadId: ThreadId) {
    const owner = yield* requireOwner(threadId);
    return yield* withControlSession(owner.contents, (send, session) =>
      Effect.gen(function* () {
        if (!session.diagnosticsEnabled) {
          yield* Effect.all(
            [send("Accessibility.enable"), send("Network.enable"), send("Log.enable")],
            { concurrency: "unbounded", discard: true },
          );
          session.diagnosticsEnabled = true;
        }
        const [result, accessibilityTree, sourceImage] = yield* Effect.all(
          [
            evaluateWithDebugger<PageSnapshotResult>(send, snapshotScript(), true),
            send("Accessibility.getFullAXTree"),
            attemptPromise("capturePage", () => owner.contents.capturePage()),
          ] as const,
          { concurrency: "unbounded" },
        );
        if (!isPageSnapshotResult(result)) {
          return yield* browserAutomationError(
            "snapshot",
            new Error("Browser snapshot did not return page metadata."),
          );
        }
        const sourceSize = sourceImage.getSize();
        const image =
          sourceSize.width > MAX_SCREENSHOT_WIDTH
            ? sourceImage.resize({ width: MAX_SCREENSHOT_WIDTH })
            : sourceImage;
        const size = image.getSize();
        return {
          ...result,
          accessibilityTree,
          consoleEntries: [...session.diagnostics.consoleEntries],
          networkEntries: [...session.diagnostics.networkEntries],
          screenshot: {
            mimeType: "image/png" as const,
            data: image.toPNG().toString("base64"),
            width: size.width,
            height: size.height,
          },
        };
      }),
    );
  });

  const click = Effect.fn("browserAutomation.click")(function* (
    threadId: ThreadId,
    input: BrowserAutomationClickInput,
  ) {
    const owner = yield* requireOwner(threadId);
    yield* withControlSession(owner.contents, (send) =>
      Effect.gen(function* () {
        const point =
          input.x !== undefined && input.y !== undefined
            ? { x: input.x, y: input.y }
            : yield* resolvePoint(send, input);
        yield* send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
        yield* send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
      }),
    );
  });

  const type = Effect.fn("browserAutomation.type")(function* (
    threadId: ThreadId,
    input: BrowserAutomationTypeInput,
  ) {
    const owner = yield* requireOwner(threadId);
    yield* withControlSession(owner.contents, (send) =>
      Effect.gen(function* () {
        if (input.selector || input.locator) {
          yield* ensurePlaywrightInjected(send);
          const result = yield* evaluateWithDebugger(send, focusTargetScript(input), true);
          if (isErrorResult(result)) {
            return yield* browserAutomationError("type", new Error(result.error));
          }
        }
        yield* send("Input.insertText", { text: input.text });
      }),
    );
  });

  const press = Effect.fn("browserAutomation.press")(function* (
    threadId: ThreadId,
    input: BrowserAutomationPressInput,
  ) {
    const owner = yield* requireOwner(threadId);
    yield* withControlSession(owner.contents, (send) =>
      Effect.gen(function* () {
        const modifiers = cdpModifiers(input.modifiers);
        yield* send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: input.key, modifiers });
        yield* send("Input.dispatchKeyEvent", { type: "keyUp", key: input.key, modifiers });
      }),
    );
  });

  const scroll = Effect.fn("browserAutomation.scroll")(function* (
    threadId: ThreadId,
    input: BrowserAutomationScrollInput,
  ) {
    const owner = yield* requireOwner(threadId);
    yield* withControlSession(owner.contents, (send) =>
      Effect.gen(function* () {
        const point =
          input.selector || input.locator ? yield* resolvePoint(send, input) : { x: 10, y: 10 };
        yield* send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: point.x,
          y: point.y,
          deltaX: input.deltaX ?? 0,
          deltaY: input.deltaY ?? 0,
        });
      }),
    );
  });

  const evaluate = Effect.fn("browserAutomation.evaluate")(function* (
    threadId: ThreadId,
    input: BrowserAutomationEvaluateInput,
  ) {
    const owner = yield* requireOwner(threadId);
    return yield* withControlSession(owner.contents, (send) =>
      evaluateWithDebugger(send, input.expression, true, input.awaitPromise ?? true),
    );
  });

  const waitFor = Effect.fn("browserAutomation.waitFor")(function* (
    threadId: ThreadId,
    input: BrowserAutomationWaitForInput,
  ) {
    const owner = yield* requireOwner(threadId);
    yield* withControlSession(owner.contents, (send) =>
      Effect.gen(function* () {
        if (input.selector || input.locator) yield* ensurePlaywrightInjected(send);
        const timeout = timeoutMs(input.timeoutMs);
        const deadline = Date.now() + timeout;
        while (Date.now() <= deadline) {
          const result = yield* evaluateWithDebugger<boolean>(
            send,
            waitConditionScript(input),
            true,
          );
          if (result === true) return;
          yield* Effect.promise(() => sleep(100));
        }
        return yield* browserAutomationError(
          "waitFor",
          new Error(`Browser wait condition timed out after ${timeout}ms.`),
        );
      }),
    );
  });

  yield* Effect.addFinalizer(() => detachAllControlSessions());

  return DesktopBrowserAutomation.of({
    register,
    unregister,
    status,
    open,
    navigate,
    snapshot,
    click,
    type,
    press,
    scroll,
    evaluate,
    waitFor,
  });
});

export const layer = Layer.effect(DesktopBrowserAutomation, makeDesktopBrowserAutomation());
