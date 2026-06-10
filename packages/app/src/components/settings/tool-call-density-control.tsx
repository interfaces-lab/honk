import {
  USER_CONVERSATION_DENSITY_VALUES,
  type ConversationDensity,
} from "@multi/contracts/settings";
import { IconChevronRightMedium } from "central-icons";

import { ToolCallRenderer, type ToolCallModel } from "../chat/message/tool-renderer";

// Slider runs Compact (left) to Detailed (right), matching Cursor's control.
const SLIDER_DENSITIES: readonly ConversationDensity[] = [
  ...USER_CONVERSATION_DENSITY_VALUES,
].reverse();

const DENSITY_ARIA_LABELS: Record<ConversationDensity, string> = {
  detailed: "Detailed, edits with diffs and shells with output",
  "compact-ungrouped": "Balanced, compact edits and compact shells, not grouped",
  "compact-all-grouped": "Compact grouped tool calls",
};

export const PREVIEW_EDIT_TOOL_CALL: ToolCallModel = {
  tool: {
    case: "editToolCall",
    value: {
      action: "Edited",
      details: "math.ts",
      path: "math.ts",
      stats: { additions: 4, deletions: 1 },
      artifacts: [
        {
          type: "diff",
          format: "unified",
          source: "preview",
          files: [{ path: "math.ts", additions: 4, deletions: 1 }],
          unifiedDiff: "@@ -1,3 +1,3 @@\n-old line\n+new line\n",
        },
      ],
    },
  },
};

export const PREVIEW_SHELL_TOOL_CALL: ToolCallModel = {
  tool: {
    case: "shellToolCall",
    value: {
      action: "Ran",
      details: "npm test",
      command: "npm test",
      output: "ok",
    },
  },
};

export function ToolCallDensitySlider(props: {
  value: ConversationDensity;
  onChange: (value: ConversationDensity) => void;
}) {
  const index = Math.max(0, SLIDER_DENSITIES.indexOf(props.value));

  return (
    <div className="flex w-full flex-col gap-1 sm:w-34">
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-[6px]"
        >
          {SLIDER_DENSITIES.map((density) => (
            <span
              key={density}
              className="size-1 rounded-full bg-multi-stroke-tertiary opacity-60"
            />
          ))}
        </div>
        <input
          aria-label="Tool Call Density"
          aria-valuetext={DENSITY_ARIA_LABELS[props.value]}
          className="multi-settings-range-slider relative z-1 h-4 w-full"
          type="range"
          min={0}
          max={SLIDER_DENSITIES.length - 1}
          step={1}
          value={index}
          onChange={(event) => {
            const next = SLIDER_DENSITIES[Number(event.target.value)];
            if (next) {
              props.onChange(next);
            }
          }}
        />
      </div>
      <div className="flex justify-between text-detail text-multi-fg-tertiary">
        <span>Compact</span>
        <span>Detailed</span>
      </div>
    </div>
  );
}

export function ToolCallDensityPreview({ density }: { density: ConversationDensity }) {
  if (density === "compact-all-grouped") {
    return (
      <div className="mt-2 w-full max-w-72" data-density-preview="combined">
        <div
          className="inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden text-conversation text-multi-fg-tertiary"
          data-work-group-header=""
        >
          <span className="shrink-0 whitespace-nowrap tabular-nums">Explored</span>
          <span aria-hidden="true" className="shrink-0 text-multi-fg-tertiary">
            ·
          </span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary tabular-nums">
            2 files, ran 2 commands
          </span>
          <IconChevronRightMedium
            aria-hidden="true"
            className="size-3 shrink-0 text-multi-icon-tertiary"
          />
        </div>
      </div>
    );
  }

  const cards = density === "detailed";
  return (
    <div
      className="mt-2 flex w-full max-w-72 flex-col gap-1"
      data-density-preview={cards ? "cards" : "rows"}
    >
      <ToolCallRenderer toolCall={PREVIEW_EDIT_TOOL_CALL} conversationDensity={density} />
      <ToolCallRenderer toolCall={PREVIEW_SHELL_TOOL_CALL} conversationDensity={density} />
    </div>
  );
}
