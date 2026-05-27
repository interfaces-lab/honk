import { afterEach } from "vitest";

type GuardedConsoleMethod = "error" | "warn";

interface CapturedConsoleMessage {
  method: GuardedConsoleMethod;
  stack: string | null;
  text: string;
}

interface AllowedConsoleMessage {
  method: GuardedConsoleMethod;
  pattern: RegExp;
  reason: string;
  stackPattern?: RegExp;
}

const allowedConsoleMessages: readonly AllowedConsoleMessage[] = [
  {
    method: "error",
    pattern: /^flushSync was called from inside a lifecycle method\./,
    stackPattern: /@base-ui_react_tooltip\.js|@base-ui-components\/react/,
    reason:
      "TODO: Base UI tooltip hover currently calls ReactDOM.flushSync during React 19 render work.",
  },
];

const capturedConsoleMessages: CapturedConsoleMessage[] = [];
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

function formatConsoleArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatConsoleMessage(args: readonly unknown[]): string {
  return args.map(formatConsoleArgument).join(" ");
}

function isAllowedConsoleMessage(message: CapturedConsoleMessage): boolean {
  return allowedConsoleMessages.some(
    (allowed) =>
      allowed.reason.trim().length > 0 &&
      allowed.method === message.method &&
      allowed.pattern.test(message.text) &&
      (allowed.stackPattern === undefined ||
        (message.stack !== null && allowed.stackPattern.test(message.stack))),
  );
}

console.error = (...args: unknown[]) => {
  const message = {
    method: "error",
    stack: new Error().stack ?? null,
    text: formatConsoleMessage(args),
  } satisfies CapturedConsoleMessage;
  capturedConsoleMessages.push(message);
  if (!isAllowedConsoleMessage(message)) {
    originalConsoleError(...args);
  }
};

console.warn = (...args: unknown[]) => {
  const message = {
    method: "warn",
    stack: new Error().stack ?? null,
    text: formatConsoleMessage(args),
  } satisfies CapturedConsoleMessage;
  capturedConsoleMessages.push(message);
  if (!isAllowedConsoleMessage(message)) {
    originalConsoleWarn(...args);
  }
};

afterEach(() => {
  const unexpectedMessages = capturedConsoleMessages.filter(
    (message) => !isAllowedConsoleMessage(message),
  );
  capturedConsoleMessages.length = 0;

  if (unexpectedMessages.length === 0) {
    return;
  }

  const formattedMessages = ["Unexpected browser console warn/error output."];
  formattedMessages.push(
    "Move intentional warnings into allowedConsoleMessages with a local reason.",
  );
  for (const message of unexpectedMessages) {
    formattedMessages.push(`${message.method}: ${message.text}`);
    if (message.stack) {
      formattedMessages.push(message.stack);
    }
  }

  throw new Error(formattedMessages.join("\n"));
});
