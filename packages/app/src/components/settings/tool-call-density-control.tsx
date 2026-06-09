import {
  USER_CONVERSATION_DENSITY_VALUES,
  type UserConversationDensity,
} from "@multi/contracts/settings";

import { cn } from "~/lib/utils";

// Slider runs Compact (left) to Detailed (right), matching Cursor's control.
const SLIDER_DENSITIES: readonly UserConversationDensity[] = [
  ...USER_CONVERSATION_DENSITY_VALUES,
].reverse();

const DENSITY_ARIA_LABELS: Record<UserConversationDensity, string> = {
  detailed: "Detailed, edits with diffs and shells with output",
  "compact-ungrouped": "Compact edits and compact shells, not grouped",
  "compact-all-grouped": "Compact grouped tool calls",
};

export function ToolCallDensitySlider(props: {
  value: UserConversationDensity;
  onChange: (value: UserConversationDensity) => void;
}) {
  const index = Math.max(0, SLIDER_DENSITIES.indexOf(props.value));

  return (
    <div className="flex w-full flex-col gap-1 sm:w-34">
      <input
        aria-label="Tool call density"
        aria-valuetext={DENSITY_ARIA_LABELS[props.value]}
        className="multi-settings-range-slider h-4 w-full"
        style={{ accentColor: "var(--multi-action)" }}
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
      <div className="flex justify-between text-detail text-multi-fg-tertiary">
        <span>Compact</span>
        <span>Detailed</span>
      </div>
    </div>
  );
}

// Canned sample of two edits and two shell commands, rendered the way the chat timeline
// renders tool calls at the selected density: bordered cards with diff/output skeletons
// (detailed), plain rows (balanced), or one grouped summary line (compact).
export function ToolCallDensityPreview({ density }: { density: UserConversationDensity }) {
  if (density === "compact-all-grouped") {
    return (
      <div className="mt-2 w-full max-w-72" data-density-preview="combined">
        <PreviewHeader label="Edited" meta="2 files, ran 2 commands" />
      </div>
    );
  }

  const cards = density === "detailed";
  return (
    <div
      className={cn("mt-2 flex w-full max-w-72 flex-col", cards ? "gap-2" : "gap-1")}
      data-density-preview={cards ? "cards" : "rows"}
    >
      <PreviewSlot cards={cards} label="Edited math.ts" stats="+4 -1" body="diff" />
      <PreviewSlot cards={cards} label="Edited README.md" stats="+5 -1" body="diff" />
      <PreviewSlot cards={cards} label="Ran focused tests" meta="npm test" body="output" />
      <PreviewSlot cards={cards} label="Ran type-check" meta="npm run" body="output" />
    </div>
  );
}

function PreviewSlot(props: {
  cards: boolean;
  label: string;
  meta?: string;
  stats?: string;
  body: "diff" | "output";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        props.cards &&
          "rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary p-2.5",
      )}
    >
      <PreviewHeader label={props.label} meta={props.meta} stats={props.stats} />
      {props.cards ? (
        props.body === "diff" ? (
          <div className="flex flex-col gap-1">
            <PreviewBar className="w-full bg-multi-diff-deletion/25" />
            <PreviewBar className="w-3/5 bg-multi-diff-deletion/25" />
            <PreviewBar className="w-full bg-multi-diff-addition/25" />
            <PreviewBar className="w-3/5 bg-multi-diff-addition/25" />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <PreviewBar className="w-full bg-multi-bg-quaternary" />
            <PreviewBar className="w-3/5 bg-multi-bg-quaternary" />
          </div>
        )
      ) : null}
    </div>
  );
}

function PreviewHeader(props: {
  label: string;
  meta?: string | undefined;
  stats?: string | undefined;
}) {
  const [added, removed] = props.stats?.split(" ") ?? [];
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-body">
      <span className="shrink-0 text-multi-fg-primary">{props.label}</span>
      {added && removed ? (
        <span className="inline-flex shrink-0 gap-1 tabular-nums">
          <span className="text-multi-diff-addition">{added}</span>
          <span className="text-multi-diff-deletion">{removed}</span>
        </span>
      ) : null}
      {props.meta ? (
        <span className="min-w-0 truncate text-multi-fg-tertiary">{props.meta}</span>
      ) : null}
    </div>
  );
}

function PreviewBar({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn("h-2 rounded-full", className)} />;
}
