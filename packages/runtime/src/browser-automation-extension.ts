import { defineTool, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type {
  BrowserAutomationClickInput,
  BrowserAutomationController,
  BrowserAutomationEvaluateInput,
  BrowserAutomationNavigateInput,
  BrowserAutomationOpenInput,
  BrowserAutomationPressInput,
  BrowserAutomationScrollInput,
  BrowserAutomationSnapshot,
  BrowserAutomationStatus,
  BrowserAutomationTypeInput,
  BrowserAutomationWaitForInput,
  ThreadId,
} from "@honk/contracts";

const MAX_TEXT_RESULT_CHARS = 24_000;

const OptionalTimeoutMs = Type.Optional(
  Type.Number({ description: "Maximum wait in milliseconds. Defaults to 15000; maximum 60000." }),
);

const BrowserOpenParams = Type.Object({
  url: Type.Optional(
    Type.String({ description: "Optional initial URL, for example https://example.com." }),
  ),
  show: Type.Optional(Type.Boolean({ description: "Reveal the browser panel. Defaults to true." })),
  reuseExistingTab: Type.Optional(
    Type.Boolean({ description: "Reuse the current browser tab when possible. Defaults to true." }),
  ),
});

const BrowserNavigateParams = Type.Object({
  url: Type.String({ description: "URL to navigate the active Honk browser tab to." }),
  readiness: Type.Optional(
    Type.Union([Type.Literal("load"), Type.Literal("domContentLoaded"), Type.Literal("none")], {
      description: "Readiness milestone before returning. Defaults to load.",
    }),
  ),
  timeoutMs: OptionalTimeoutMs,
});

const LocatorTarget = {
  selector: Type.Optional(Type.String({ description: "CSS selector target." })),
  locator: Type.Optional(
    Type.String({
      description:
        "Semantic locator. Supports text=Label and role=button[name='Label']; CSS selectors also work.",
    }),
  ),
};

const BrowserClickParams = Type.Object({
  ...LocatorTarget,
  x: Type.Optional(Type.Number({ description: "Viewport-relative X coordinate in CSS pixels." })),
  y: Type.Optional(Type.Number({ description: "Viewport-relative Y coordinate in CSS pixels." })),
  timeoutMs: OptionalTimeoutMs,
});

const BrowserTypeParams = Type.Object({
  ...LocatorTarget,
  text: Type.String({ description: "Literal text to insert." }),
  clear: Type.Optional(
    Type.Boolean({ description: "Clear existing text first. Defaults to false." }),
  ),
  timeoutMs: OptionalTimeoutMs,
});

const BrowserPressParams = Type.Object({
  key: Type.String({ description: "Keyboard key, for example Enter, Escape, Tab, or ArrowDown." }),
  modifiers: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("Alt"),
        Type.Literal("Control"),
        Type.Literal("Meta"),
        Type.Literal("Shift"),
      ]),
      {
        description: "Modifier keys held while pressing key.",
      },
    ),
  ),
});

const BrowserScrollParams = Type.Object({
  ...LocatorTarget,
  deltaX: Type.Optional(Type.Number({ description: "Horizontal scroll delta in CSS pixels." })),
  deltaY: Type.Optional(Type.Number({ description: "Vertical scroll delta in CSS pixels." })),
});

const BrowserEvaluateParams = Type.Object({
  expression: Type.String({ description: "JavaScript expression evaluated in the page." }),
  awaitPromise: Type.Optional(
    Type.Boolean({ description: "Await returned promises. Defaults to true." }),
  ),
});

const BrowserWaitForParams = Type.Object({
  ...LocatorTarget,
  text: Type.Optional(Type.String({ description: "Visible text substring that must appear." })),
  urlIncludes: Type.Optional(Type.String({ description: "URL substring that must appear." })),
  timeoutMs: OptionalTimeoutMs,
});

function textResult<TDetails>(text: string, details: TDetails) {
  return {
    content: [{ type: "text" as const, text: clampText(text) }],
    details,
  };
}

function clampText(text: string): string {
  return text.length <= MAX_TEXT_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_TEXT_RESULT_CHARS)}\n… [truncated]`;
}

function formatStatus(status: BrowserAutomationStatus): string {
  if (!status.available) return "No Honk browser tab is attached to this thread.";
  const url = status.url ?? "about:blank";
  const title = status.title ? ` (${status.title})` : "";
  const loading = status.loading ? " loading" : "";
  return `Honk browser is ${status.visible ? "visible" : "hidden"}${loading}: ${url}${title}`;
}

function formatSnapshot(snapshot: BrowserAutomationSnapshot): string {
  const elements = snapshot.interactiveElements
    .slice(0, 40)
    .map((element, index) => {
      const role = element.role ? ` role=${element.role}` : "";
      const name = element.name ? ` name=${JSON.stringify(element.name.slice(0, 120))}` : "";
      return `${index + 1}. ${element.tag}${role}${name} selector=${JSON.stringify(element.selector)} x=${Math.round(element.x)} y=${Math.round(element.y)}`;
    })
    .join("\n");
  const consoleEntries = snapshot.consoleEntries
    .slice(-10)
    .map((entry) => `${entry.level}: ${entry.text}`)
    .join("\n");
  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title || "(untitled)"}`,
    `Loading: ${snapshot.loading ? "yes" : "no"}`,
    "",
    "Visible text:",
    snapshot.visibleText || "(none)",
    "",
    "Interactive elements:",
    elements || "(none)",
    consoleEntries ? `\nRecent console:\n${consoleEntries}` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createBrowserAutomationExtension(options: {
  readonly controller?: BrowserAutomationController | null | undefined;
  readonly threadId: ThreadId;
}): ExtensionFactory {
  return (pi) => {
    const controller = options.controller;
    const threadId = options.threadId;
    const requireController = (): BrowserAutomationController => {
      if (!controller) {
        throw new Error("Honk browser automation is not available in this runtime.");
      }
      return controller;
    };

    pi.registerTool(
      defineTool({
        name: "browser_status",
        label: "Browser Status",
        description:
          "Report whether the current Honk thread has an automation-capable browser tab, including URL, title, visibility, and loading state.",
        promptSnippet:
          "Use browser_status before browser work to inspect the attached Honk browser.",
        promptGuidelines: [
          "For browser work, first call browser_status. If no browser is attached, call browser_open before concluding unavailable.",
          "Use Honk browser tools before external browser automation.",
        ],
        parameters: Type.Object({}),
        async execute() {
          const status = await requireController().status(threadId);
          return textResult(formatStatus(status), status);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_open",
        label: "Open Browser",
        description:
          "Reveal and initialize the Honk browser for this thread, optionally navigating to a URL.",
        promptSnippet:
          "Use browser_open to reveal the product-native browser when browser_status is unavailable.",
        parameters: BrowserOpenParams,
        async execute(_toolCallId, params: BrowserAutomationOpenInput) {
          const status = await requireController().open(threadId, params);
          return textResult(formatStatus(status), status);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_navigate",
        label: "Navigate Browser",
        description:
          "Navigate the active Honk browser tab to a URL and wait for readiness by default.",
        promptSnippet: "Use browser_navigate to navigate the shared Honk browser tab.",
        parameters: BrowserNavigateParams,
        async execute(_toolCallId, params: BrowserAutomationNavigateInput) {
          const status = await requireController().navigate(threadId, params);
          return textResult(formatStatus(status), status);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_snapshot",
        label: "Inspect Browser",
        description:
          "Inspect the current Honk browser page. Returns URL/title/loading state, visible text, interactive elements, recent console entries, and a screenshot.",
        promptSnippet:
          "Use browser_snapshot before browser interactions and prefer returned selectors over coordinates.",
        parameters: Type.Object({}),
        async execute() {
          const snapshot = await requireController().snapshot(threadId);
          return {
            content: [
              { type: "text" as const, text: clampText(formatSnapshot(snapshot)) },
              {
                type: "image" as const,
                data: snapshot.screenshot.data,
                mimeType: snapshot.screenshot.mimeType,
              },
            ],
            details: snapshot,
          };
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_click",
        label: "Click Browser",
        description:
          "Click one target in the active Honk browser tab. Prefer selector or locator from browser_snapshot over coordinates.",
        promptSnippet: "Use browser_click for focused page interactions.",
        parameters: BrowserClickParams,
        async execute(_toolCallId, params: BrowserAutomationClickInput) {
          await requireController().click(threadId, params);
          return textResult("Clicked browser target.", params);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_type",
        label: "Type in Browser",
        description: "Type literal text into the active Honk browser page.",
        promptSnippet: "Use browser_type to fill inputs in the Honk browser.",
        parameters: BrowserTypeParams,
        async execute(_toolCallId, params: BrowserAutomationTypeInput) {
          await requireController().type(threadId, params);
          return textResult("Typed into browser target.", { ...params, text: params.text });
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_press",
        label: "Press Browser Key",
        description: "Press one keyboard key in the active Honk browser page.",
        promptSnippet:
          "Use browser_press for Enter, Escape, Tab, arrows, and shortcuts in the Honk browser.",
        parameters: BrowserPressParams,
        async execute(_toolCallId, params: BrowserAutomationPressInput) {
          await requireController().press(threadId, params);
          return textResult(`Pressed ${params.key}.`, params);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_scroll",
        label: "Scroll Browser",
        description: "Scroll the active Honk browser page or a scrollable element.",
        promptSnippet: "Use browser_scroll to move through the Honk browser page.",
        parameters: BrowserScrollParams,
        async execute(_toolCallId, params: BrowserAutomationScrollInput) {
          await requireController().scroll(threadId, params);
          return textResult("Scrolled browser.", params);
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_evaluate",
        label: "Evaluate Browser JavaScript",
        description:
          "Evaluate a JavaScript expression in the active Honk browser page. Prefer snapshot and semantic actions first.",
        promptSnippet:
          "Use browser_evaluate for browser inspection or interactions unsupported by focused browser tools.",
        parameters: BrowserEvaluateParams,
        async execute(_toolCallId, params: BrowserAutomationEvaluateInput) {
          const value = await requireController().evaluate(threadId, params);
          return textResult(stringifyResult(value), { input: params, result: value });
        },
      }),
    );

    pi.registerTool(
      defineTool({
        name: "browser_wait_for",
        label: "Wait for Browser",
        description:
          "Wait until selector/locator, visible text, and/or URL conditions match in the Honk browser.",
        promptSnippet:
          "Use browser_wait_for after navigation or interactions that update the page asynchronously.",
        parameters: BrowserWaitForParams,
        async execute(_toolCallId, params: BrowserAutomationWaitForInput) {
          await requireController().waitFor(threadId, params);
          return textResult("Browser wait condition matched.", params);
        },
      }),
    );
  };
}
