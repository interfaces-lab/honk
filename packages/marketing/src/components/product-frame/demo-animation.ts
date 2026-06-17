import type { ToolDiffArtifact } from "~/session-logic";
import type { ToolCallModel } from "~/components/chat/message/tool-renderer";

import type { ThreadState } from "./demo-data";

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
  messages: readonly MarketingTimelineItem[];
  threadState: ThreadState;
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
  '-            <ProductFrame className="w-[min(66vw,950px)]" />',
  '+            <ProductFrame className="w-[min(66vw,950px)] translate-y-10" />',
  '            <EdgeMask intensity="soft" />',
].join("\n");

const marketingEditDiffArtifact = {
  type: "diff",
  format: "unified",
  source: "result",
  files: [{ path: "packages/marketing/src/routes/index.tsx", additions: 1, deletions: 1 }],
  unifiedDiff: MARKETING_INDEX_PATCH,
} as const satisfies ToolDiffArtifact;

const userMessage: MarketingTimelineItem = {
  kind: "user",
  text: "Polish the marketing page so the workspace preview feels like Honk itself.",
};

const assistantMessage: MarketingTimelineItem = {
  kind: "assistant",
  text: "I'll mirror the sidebar, chat timeline, and workbench chrome with real Honk styling.",
};

const readToolLoading: MarketingTimelineItem = {
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

const readTool: MarketingTimelineItem = {
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

const editToolLoading: MarketingTimelineItem = {
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

const editToolWithDiff: MarketingTimelineItem = {
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

export const marketingDemoSteps = [
  {
    holdMs: 900,
    scene: {
      messages: [],
      threadState: "running",
    },
  },
  {
    holdMs: 2200,
    scene: {
      messages: [userMessage],
      threadState: "running",
    },
  },
  {
    holdMs: 2600,
    scene: {
      messages: [userMessage, assistantMessage],
      threadState: "running",
    },
  },
  {
    holdMs: 1400,
    scene: {
      messages: [userMessage, assistantMessage, readToolLoading],
      threadState: "running",
    },
  },
  {
    holdMs: 1200,
    scene: {
      messages: [userMessage, assistantMessage, readTool],
      threadState: "running",
    },
  },
  {
    holdMs: 1600,
    scene: {
      messages: [userMessage, assistantMessage, readTool, editToolLoading],
      threadState: "running",
    },
  },
  {
    holdMs: 4200,
    scene: {
      messages: [userMessage, assistantMessage, readTool, editToolWithDiff],
      threadState: "done",
    },
  },
] as const satisfies readonly MarketingDemoStep[];

export const marketingDemoFinalScene =
  marketingDemoSteps[marketingDemoSteps.length - 1]?.scene ?? marketingDemoSteps[0].scene;
