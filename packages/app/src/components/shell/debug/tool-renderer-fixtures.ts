import type { UiToolCallBlock } from "~/lib/ui-session-types";

import type { ToolData } from "~/lib/tool-renderers";

function call(name: string, args: Record<string, unknown>): UiToolCallBlock {
  return { type: "toolCall", name, arguments: args };
}

const readCall = call("read", { path: "packages/app/src/lib/utils.ts" });
const readResult = `export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const editCall = call("edit", {
  path: "packages/app/src/lib/foo.ts",
  oldText: "export const v = 1;\n",
  newText: "export const v = 2;\n",
});

const writeCall = call("write", {
  path: "packages/app/src/lib/new-module.ts",
  content: 'export const hello = "world";\n',
});

const bashCall = call("bash", { command: "pnpm run fmt", timeout: 120 });

const grepCall = call("grep", { pattern: "toolBody", path: "packages/app/src/lib" });
const grepResult = "packages/app/src/lib/tool-renderers.tsx:52:export function toolBody";

const findCall = call("find", { glob: "*.tsx", query: "chat-composer" });
const findResult = "packages/app/src/components/shell/chat/messages.tsx";

const askCall = call("ask", { prompt: "continue?" });
const askResult = "User chose: proceed with migration.";

const lsCall = call("ls", { path: "packages/app/src/components/shell/debug" });
const lsResult =
  "cursor-composer-intents-feed.tsx\ncursor-native-previews.tsx\ndebug-gallery-page.tsx";

const webSearchCall = call("web_search", { query: "vitest react" });
const webSearchResult = '{"ok":true,"hits":[{"title":"Vitest","url":"https://vitest.dev"}]}';

const unknownCall = call("custom_provider_tool", { foo: "bar" });
const unknownResult = "unregistered tool output";

function base(partial: Omit<ToolData, "embedded">): ToolData {
  return {
    name: partial.name,
    call: partial.call,
    args: partial.args,
    result: partial.result,
    error: partial.error,
    details: partial.details,
    expanded: partial.expanded,
  };
}

/** Collapsed + expanded fixtures per map-backed renderer (frozen copy for gallery + tests). */
export const toolRendererFixturePairs: ReadonlyArray<{
  slug: string;
  collapsed: ToolData;
  expanded: ToolData;
}> = [
  {
    slug: "read",
    collapsed: base({
      name: "read",
      call: readCall,
      args: JSON.stringify(readCall.arguments),
      result: readResult,
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "read",
      call: readCall,
      args: JSON.stringify(readCall.arguments),
      result: readResult,
      error: false,
      details: null,
      expanded: true,
    }),
  },
  {
    slug: "edit",
    collapsed: base({
      name: "edit",
      call: editCall,
      args: JSON.stringify(editCall.arguments),
      result: "Applied edit.",
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "edit",
      call: editCall,
      args: JSON.stringify(editCall.arguments),
      result: "Applied edit.",
      error: false,
      details: null,
      expanded: true,
    }),
  },
  {
    slug: "write",
    collapsed: base({
      name: "write",
      call: writeCall,
      args: JSON.stringify(writeCall.arguments),
      result: "",
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "write",
      call: writeCall,
      args: JSON.stringify(writeCall.arguments),
      result: "Wrote file.",
      error: false,
      details: null,
      expanded: true,
    }),
  },
  {
    slug: "bash",
    collapsed: base({
      name: "bash",
      call: bashCall,
      args: JSON.stringify(bashCall.arguments),
      result: "Done in 1.2s.",
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "bash",
      call: bashCall,
      args: JSON.stringify(bashCall.arguments),
      result: "Done in 1.2s.",
      error: false,
      details: null,
      expanded: true,
    }),
  },
  {
    slug: "grep",
    collapsed: base({
      name: "grep",
      call: grepCall,
      args: JSON.stringify(grepCall.arguments),
      result: grepResult,
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "grep",
      call: grepCall,
      args: JSON.stringify(grepCall.arguments),
      result: `${grepResult}\npackages/app/src/lib/chat-timeline.ts:10:  toolBody(`,
      error: false,
      details: { truncation: true, matchLimitReached: 500 },
      expanded: true,
    }),
  },
  {
    slug: "find",
    collapsed: base({
      name: "find",
      call: findCall,
      args: JSON.stringify(findCall.arguments),
      result: findResult,
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "find",
      call: findCall,
      args: JSON.stringify(findCall.arguments),
      result: `${findResult}\npackages/app/src/components/shell/chat/rows.tsx`,
      error: false,
      details: { truncation: true, resultLimitReached: 200 },
      expanded: true,
    }),
  },
  {
    slug: "ask",
    collapsed: base({
      name: "ask",
      call: askCall,
      args: JSON.stringify(askCall.arguments),
      result: askResult,
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "ask",
      call: askCall,
      args: JSON.stringify(askCall.arguments),
      result: askResult,
      error: false,
      details: null,
      expanded: true,
    }),
  },
  {
    slug: "ls",
    collapsed: base({
      name: "ls",
      call: lsCall,
      args: JSON.stringify(lsCall.arguments),
      result: lsResult,
      error: false,
      details: null,
      expanded: false,
    }),
    expanded: base({
      name: "ls",
      call: lsCall,
      args: JSON.stringify(lsCall.arguments),
      result: lsResult,
      error: false,
      details: { truncation: true, entryLimitReached: 400 },
      expanded: true,
    }),
  },
];

export const websearchFixturePair = {
  slug: "web_search",
  collapsed: base({
    name: "web_search",
    call: webSearchCall,
    args: JSON.stringify(webSearchCall.arguments),
    result: webSearchResult,
    error: false,
    details: null,
    expanded: false,
  }),
  expanded: base({
    name: "web_search",
    call: webSearchCall,
    args: JSON.stringify(webSearchCall.arguments),
    result: webSearchResult,
    error: false,
    details: null,
    expanded: true,
  }),
};

export const fallbackUnknownFixturePair = {
  slug: "fallback",
  collapsed: base({
    name: unknownCall.name,
    call: unknownCall,
    args: JSON.stringify(unknownCall.arguments),
    result: unknownResult,
    error: false,
    details: null,
    expanded: false,
  }),
  expanded: base({
    name: unknownCall.name,
    call: unknownCall,
    args: JSON.stringify(unknownCall.arguments),
    result: unknownResult,
    error: false,
    details: null,
    expanded: true,
  }),
};
