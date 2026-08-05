// Model choice for a new chat. Presentational: the catalog arrives from the
// start controller (models.list, configured providers only — spec/core.md
// section 11). Credential entry itself has no UI yet; the CLI records keys:
// `pnpm --filter @honk/core cli login <providerId> <key>`.

import { borderVars, colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { ModelChoice } from "./chat-controller";
import type { ModelOption } from "./start-controller";

// Wide enough for "provider / model name" without crowding the row.
const MODEL_SELECT_MAX_WIDTH = "260px";

const styles = stylex.create({
  select: {
    boxSizing: "border-box",
    maxWidth: MODEL_SELECT_MAX_WIDTH,
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    backgroundColor: colorVars["--honk-color-bg-chrome"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
});

export function ModelSelect({
  options,
  value,
  onChange,
}: {
  readonly options: readonly ModelOption[];
  readonly value: ModelChoice | null;
  readonly onChange: (choice: ModelChoice | null) => void;
}): React.ReactElement {
  const selected = value === null ? "" : `${value.providerId}/${value.modelId}`;
  return (
    <select
      {...stylex.props(styles.select)}
      value={selected}
      aria-label="Model"
      onChange={(event) => {
        const key = event.target.value;
        const option = options.find((entry) => `${entry.providerId}/${entry.modelId}` === key);
        onChange(option === undefined ? null : option);
      }}
    >
      <option value="">Default model</option>
      {options.map((option) => (
        <option
          key={`${option.providerId}/${option.modelId}`}
          value={`${option.providerId}/${option.modelId}`}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}
