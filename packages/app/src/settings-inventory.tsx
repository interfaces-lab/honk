// Read-mostly settings sections (plugins, rules, MCP, hooks) all show the same
// merged OpenCode runtime inventory. The settings panel is keyed by section, so
// each one remounts on open and a fetch-on-mount phase union is enough state.

import * as stylex from "@stylexjs/stylex";
import type { OpenCodeClient } from "@honk/opencode";
import { Button, Text } from "@honk/ui";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "./error-message";
import { getBoundOpenCodeClient } from "./watch-registry";

export type SettingsInventoryState<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "unavailable" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly data: T };

const styles = stylex.create({
  note: {
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
  failure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    paddingBlock: spaceVars["--honk-space-gutter"],
  },
});

// `load` must be module-scope stable so the fetch runs once per mount and once per reload.
export function useSettingsInventory<T>(load: (client: OpenCodeClient) => Promise<T>) {
  const [reloadCount, setReloadCount] = React.useState(0);
  const [state, setState] = React.useState<SettingsInventoryState<T>>({ phase: "loading" });

  React.useEffect(() => {
    const client = getBoundOpenCodeClient();
    if (client === null) {
      setState({ phase: "unavailable" });
      return;
    }
    let active = true;
    // A reload after a runtime action keeps the current list on screen instead of flashing back to loading.
    setState((current) => (current.phase === "ready" ? current : { phase: "loading" }));
    void load(client).then(
      (data) => {
        if (active) setState({ phase: "ready", data });
      },
      (cause: unknown) => {
        if (active) setState({ phase: "error", message: errorMessage(cause) });
      },
    );
    return () => {
      active = false;
    };
  }, [load, reloadCount]);

  return {
    state,
    reload: React.useCallback(() => setReloadCount((count) => count + 1), []),
  } as const;
}

export function SettingsNote(props: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div {...stylex.props(styles.note)}>
      <Text as="p" size="sm" tone="muted">
        {props.children}
      </Text>
    </div>
  );
}

export function SettingsAlert(props: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div {...stylex.props(styles.note)}>
      <Text as="p" role="alert" size="sm" tone="err">
        {props.children}
      </Text>
    </div>
  );
}

export function SettingsFailure(props: {
  readonly message: string;
  readonly onRetry: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.failure)}>
      <Text as="p" role="alert" size="sm" tone="err">
        {props.message}
      </Text>
      <Button size="sm" variant="neutral" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}

// Renders nothing once data has arrived; sections own their own empty state.
export function SettingsInventoryStatus(props: {
  readonly state: SettingsInventoryState<unknown>;
  readonly loading: string;
  readonly unavailable: string;
  readonly onRetry: () => void;
}): React.ReactElement | null {
  if (props.state.phase === "ready") return null;
  if (props.state.phase === "loading") return <SettingsNote>{props.loading}</SettingsNote>;
  if (props.state.phase === "unavailable") return <SettingsNote>{props.unavailable}</SettingsNote>;
  return <SettingsFailure message={props.state.message} onRetry={props.onRetry} />;
}
