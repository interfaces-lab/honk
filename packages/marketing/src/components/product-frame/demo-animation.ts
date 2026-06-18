import type { ToolDiffArtifact } from "~/session-logic";
import type { ToolCallModel } from "~/components/chat/message/tool-renderer";

import type { MarketingDemoThreadId, ThreadState } from "./demo-data";

export type MarketingTimelineItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | {
      kind: "tool";
      callId: string;
      toolCall: ToolCallModel;
      loading: boolean;
      defaultEditExpanded?: boolean;
    };

export type MarketingDemoScene = {
  activeThreadId: MarketingDemoThreadId;
  messages: readonly MarketingTimelineItem[];
  threadStates: Record<MarketingDemoThreadId, ThreadState>;
};

export type MarketingDemoStep = {
  holdMs: number;
  scene: MarketingDemoScene;
};

const MARKETING_INDEX_PATCH = [
  "--- packages/marketing/src/routes/index.tsx",
  "+++ packages/marketing/src/routes/index.tsx",
  "@@ -143,3 +143,3 @@",
  '            <CenterGlow variant="sunset" />',
  '-            <ProductFrame className="w-full max-w-6xl" />',
  '+            <ProductFrame className="w-full max-w-6xl @max-lg:hidden" />',
  '            <EdgeMask intensity="soft" />',
].join("\n");

const marketingEditDiffArtifact = {
  type: "diff",
  format: "unified",
  source: "result",
  files: [{ path: "packages/marketing/src/routes/index.tsx", additions: 1, deletions: 1 }],
  unifiedDiff: MARKETING_INDEX_PATCH,
} as const satisfies ToolDiffArtifact;

const marketingHomepageUser: MarketingTimelineItem = {
  kind: "user",
  text: "Polish the marketing page so the workspace preview feels like Honk itself.",
};

const marketingHomepageAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "I'll mirror the sidebar, chat timeline, and workbench chrome with real Honk styling.",
};

const marketingHomepageReadLoading: MarketingTimelineItem = {
  kind: "tool",
  callId: "read-product-frame",
  loading: true,
  toolCall: {
    tool: {
      case: "readToolCall",
      value: {
        action: "Read",
        details: "product-frame.tsx",
        path: "packages/marketing/src/components/product-frame.tsx",
      },
    },
  },
};

const marketingHomepageRead: MarketingTimelineItem = {
  kind: "tool",
  callId: "read-product-frame",
  loading: false,
  toolCall: {
    tool: {
      case: "readToolCall",
      value: {
        action: "Read",
        details: "product-frame.tsx",
        path: "packages/marketing/src/components/product-frame.tsx",
      },
    },
  },
};

const marketingHomepageEditLoading: MarketingTimelineItem = {
  kind: "tool",
  callId: "edit-index",
  loading: true,
  toolCall: {
    tool: {
      case: "editToolCall",
      value: {
        action: "Edit",
        details: "index.tsx",
        path: "index.tsx",
      },
    },
  },
};

const marketingHomepageEdit: MarketingTimelineItem = {
  kind: "tool",
  callId: "edit-index",
  loading: false,
  defaultEditExpanded: true,
  toolCall: {
    tool: {
      case: "editToolCall",
      value: {
        action: "Edit",
        details: "index.tsx",
        path: "index.tsx",
        stats: { additions: 1, deletions: 1 },
        artifacts: [marketingEditDiffArtifact],
      },
    },
  },
};

const marketingHomepageFollowUpUser: MarketingTimelineItem = {
  kind: "user",
  text: "Hide the sidebar on mobile and add a thread switcher so switching still reads clearly.",
};

const marketingHomepageFollowUpAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "Done. Mobile gets a compact thread rail under the header while desktop keeps the full sidebar.",
};

const authRedirectUser: MarketingTimelineItem = {
  kind: "user",
  text: "Users get stuck after OAuth on production. Can you trace the redirect loop?",
};

const authRedirectAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "The callback URL in session middleware still points at staging. I'll patch it and add a regression test.",
};

const authRedirectGrepLoading: MarketingTimelineItem = {
  kind: "tool",
  callId: "grep-callback-url",
  loading: true,
  toolCall: {
    tool: {
      case: "grepToolCall",
      value: {
        action: "Grep",
        details: "callbackUrl",
      },
    },
  },
};

const authRedirectGrep: MarketingTimelineItem = {
  kind: "tool",
  callId: "grep-callback-url",
  loading: false,
  toolCall: {
    tool: {
      case: "grepToolCall",
      value: {
        action: "Grepped",
        details: "callbackUrl",
        output: [
          "packages/server/src/session.ts",
          " 18: const callbackUrl = process.env.OAUTH_CALLBACK_STAGING;",
        ].join("\n"),
        artifacts: [
          {
            type: "search",
            flavor: "grep",
            query: "callbackUrl",
            output: [
              "packages/server/src/session.ts",
              " 18: const callbackUrl = process.env.OAUTH_CALLBACK_STAGING;",
            ].join("\n"),
            totalMatched: 1,
            totalIndexedFiles: 240,
          },
        ],
      },
    },
  },
};

const authRedirectEdit: MarketingTimelineItem = {
  kind: "tool",
  callId: "edit-session-middleware",
  loading: false,
  toolCall: {
    tool: {
      case: "editToolCall",
      value: {
        action: "Edit",
        details: "session.ts",
        path: "packages/server/src/session.ts",
        stats: { additions: 2, deletions: 1 },
      },
    },
  },
};

const darkModeUser: MarketingTimelineItem = {
  kind: "user",
  text: "Add dark mode tokens for the marketing surfaces and keep contrast aligned with HonkKit.",
};

const darkModeAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "I mapped the edge masks and download controls to HonkKit tokens. Need your call on accent contrast for the CTA row.",
};

const darkModeRead: MarketingTimelineItem = {
  kind: "tool",
  callId: "read-honkkit-tokens",
  loading: false,
  toolCall: {
    tool: {
      case: "readToolCall",
      value: {
        action: "Read",
        details: "styles.css",
        path: "packages/honkkit/src/styles.css",
      },
    },
  },
};

const releaseNotesUser: MarketingTimelineItem = {
  kind: "user",
  text: "Draft release notes for 0.4 covering the composer and the DialKit panel.",
};

const releaseNotesAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "Drafted. Highlights: compact composer, DialKit panel, and the dark-mode token pass.",
};

const REFACTOR_REGISTRY_PATCH = [
  "--- packages/runtime/src/tool-registry.ts",
  "+++ packages/runtime/src/tool-registry.ts",
  "@@ -42,3 +42,3 @@",
  '-import { everyTool } from "./tools/all";',
  '+const everyTool = () => import("./tools/all").then((m) => m.everyTool);',
].join("\n");

const refactorRegistryDiffArtifact = {
  type: "diff",
  format: "unified",
  source: "result",
  files: [{ path: "packages/runtime/src/tool-registry.ts", additions: 1, deletions: 1 }],
  unifiedDiff: REFACTOR_REGISTRY_PATCH,
} as const satisfies ToolDiffArtifact;

const refactorRegistryUser: MarketingTimelineItem = {
  kind: "user",
  text: "Refactor the tool registry so loaders are lazy and tree-shakeable.",
};

const refactorRegistryAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "I'll split the registry into per-tool modules and gate them behind dynamic imports.",
};

const refactorRegistryEditLoading: MarketingTimelineItem = {
  kind: "tool",
  callId: "edit-tool-registry",
  loading: true,
  toolCall: {
    tool: {
      case: "editToolCall",
      value: {
        action: "Edit",
        details: "tool-registry.ts",
        path: "packages/runtime/src/tool-registry.ts",
      },
    },
  },
};

const refactorRegistryEdit: MarketingTimelineItem = {
  kind: "tool",
  callId: "edit-tool-registry",
  loading: false,
  defaultEditExpanded: true,
  toolCall: {
    tool: {
      case: "editToolCall",
      value: {
        action: "Edit",
        details: "tool-registry.ts",
        path: "packages/runtime/src/tool-registry.ts",
        stats: { additions: 1, deletions: 1 },
        artifacts: [refactorRegistryDiffArtifact],
      },
    },
  },
};

const effectStreamsUser: MarketingTimelineItem = {
  kind: "user",
  text: "Migrate the event pipeline to Effect streams and keep backpressure bounded.",
};

const effectStreamsAssistant: MarketingTimelineItem = {
  kind: "assistant",
  text: "Stream pipeline is in. Bounded backpressure via Stream.queue with capacity 64.",
};

const effectStreamsReadLoading: MarketingTimelineItem = {
  kind: "tool",
  callId: "read-stream-pipeline",
  loading: true,
  toolCall: {
    tool: {
      case: "readToolCall",
      value: {
        action: "Read",
        details: "stream-pipeline.ts",
        path: "packages/runtime/src/stream-pipeline.ts",
      },
    },
  },
};

const effectStreamsRead: MarketingTimelineItem = {
  kind: "tool",
  callId: "read-stream-pipeline",
  loading: false,
  toolCall: {
    tool: {
      case: "readToolCall",
      value: {
        action: "Read",
        details: "stream-pipeline.ts",
        path: "packages/runtime/src/stream-pipeline.ts",
      },
    },
  },
};

function scene(
  activeThreadId: MarketingDemoThreadId,
  messages: readonly MarketingTimelineItem[],
  threadStates: Record<MarketingDemoThreadId, ThreadState>,
): MarketingDemoScene {
  return { activeThreadId, messages, threadStates };
}

const idleThreadStates: Record<MarketingDemoThreadId, ThreadState> = {
  "marketing-homepage": "running",
  "auth-redirect": "done",
  "dark-mode-tokens": "needs_attention",
  "release-notes": "draft",
  "refactor-tool-registry": "done",
  "effect-streams": "running",
};

export const marketingDemoSteps = [
  {
    holdMs: 900,
    scene: scene("marketing-homepage", [], {
      ...idleThreadStates,
      "marketing-homepage": "running",
    }),
  },
  {
    holdMs: 2200,
    scene: scene("marketing-homepage", [marketingHomepageUser], {
      ...idleThreadStates,
      "marketing-homepage": "running",
    }),
  },
  {
    holdMs: 2600,
    scene: scene("marketing-homepage", [marketingHomepageUser, marketingHomepageAssistant], {
      ...idleThreadStates,
      "marketing-homepage": "running",
    }),
  },
  {
    holdMs: 1400,
    scene: scene(
      "marketing-homepage",
      [marketingHomepageUser, marketingHomepageAssistant, marketingHomepageReadLoading],
      { ...idleThreadStates, "marketing-homepage": "running" },
    ),
  },
  {
    holdMs: 1200,
    scene: scene(
      "marketing-homepage",
      [marketingHomepageUser, marketingHomepageAssistant, marketingHomepageRead],
      { ...idleThreadStates, "marketing-homepage": "running" },
    ),
  },
  {
    holdMs: 1600,
    scene: scene(
      "marketing-homepage",
      [marketingHomepageUser, marketingHomepageAssistant, marketingHomepageRead, marketingHomepageEditLoading],
      { ...idleThreadStates, "marketing-homepage": "running" },
    ),
  },
  {
    holdMs: 3200,
    scene: scene(
      "marketing-homepage",
      [marketingHomepageUser, marketingHomepageAssistant, marketingHomepageRead, marketingHomepageEdit],
      { ...idleThreadStates, "marketing-homepage": "done" },
    ),
  },
  {
    holdMs: 2400,
    scene: scene(
      "auth-redirect",
      [authRedirectUser, authRedirectAssistant, authRedirectGrepLoading],
      { ...idleThreadStates, "auth-redirect": "running" },
    ),
  },
  {
    holdMs: 2800,
    scene: scene(
      "auth-redirect",
      [authRedirectUser, authRedirectAssistant, authRedirectGrep, authRedirectEdit],
      { ...idleThreadStates, "auth-redirect": "done" },
    ),
  },
  {
    holdMs: 2400,
    scene: scene(
      "effect-streams",
      [effectStreamsUser, effectStreamsAssistant, effectStreamsReadLoading],
      { ...idleThreadStates, "effect-streams": "running" },
    ),
  },
  {
    holdMs: 2800,
    scene: scene(
      "effect-streams",
      [effectStreamsUser, effectStreamsAssistant, effectStreamsRead],
      { ...idleThreadStates, "effect-streams": "done" },
    ),
  },
  {
    holdMs: 2200,
    scene: scene(
      "refactor-tool-registry",
      [refactorRegistryUser, refactorRegistryAssistant, refactorRegistryEditLoading],
      { ...idleThreadStates, "refactor-tool-registry": "running" },
    ),
  },
  {
    holdMs: 3000,
    scene: scene(
      "refactor-tool-registry",
      [refactorRegistryUser, refactorRegistryAssistant, refactorRegistryEdit],
      { ...idleThreadStates, "refactor-tool-registry": "done" },
    ),
  },
  {
    holdMs: 2600,
    scene: scene("dark-mode-tokens", [darkModeUser, darkModeAssistant, darkModeRead], {
      ...idleThreadStates,
      "dark-mode-tokens": "needs_attention",
    }),
  },
  {
    holdMs: 2400,
    scene: scene("release-notes", [releaseNotesUser, releaseNotesAssistant], {
      ...idleThreadStates,
      "release-notes": "draft",
    }),
  },
  {
    holdMs: 2200,
    scene: scene(
      "marketing-homepage",
      [
        marketingHomepageUser,
        marketingHomepageAssistant,
        marketingHomepageRead,
        marketingHomepageEdit,
        marketingHomepageFollowUpUser,
        marketingHomepageFollowUpAssistant,
      ],
      {
        ...idleThreadStates,
        "marketing-homepage": "done",
        "dark-mode-tokens": "needs_attention",
      },
    ),
  },
] as const satisfies readonly MarketingDemoStep[];

export const marketingDemoFinalScene =
  marketingDemoSteps[marketingDemoSteps.length - 1]?.scene ?? marketingDemoSteps[0].scene;
