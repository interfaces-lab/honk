// Starting a chat: connect, pick a folder, decide trust, choose a model,
// create — then hand off to the thread route. The living cross-reference
// between the UI and spec/core.md's trust and model contracts.

import { Badge, Button, Icon, Spinner, Text } from "@honk/ui";
import { IconFolder1 } from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { basename } from "@honk/shared/paths";
import * as React from "react";

import { DirectoryPicker } from "../directory-picker";
import { useHonkCore } from "./client";
import { ModelSelect } from "./model-select";
import { ProviderSetupCard } from "./provider-setup";
import { useChatStart } from "./start-controller";
import { TrustDialog } from "./trust-dialog";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    flexGrow: 1,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    flexGrow: 1,
    paddingBlock: spaceVars["--honk-space-panel-pad"],
  },
  waiting: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
  workspaceRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  workspacePath: {
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  mono: {
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    overflowWrap: "anywhere",
  },
  errorText: {
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-err-fg"],
  },
});

export function ChatStartPage(): React.ReactElement {
  const core = useHonkCore();
  const navigate = useNavigate();
  const start = useChatStart({
    onStarted: (sessionId) => {
      void navigate({ to: "/v2/$sessionId", params: { sessionId } });
    },
  });
  const { state } = start;

  if (core.status === "connecting") {
    return (
      <div {...stylex.props(styles.centered)}>
        <div {...stylex.props(styles.waiting)}>
          <Spinner size="sm" />
          Connecting to Honk Core
        </div>
      </div>
    );
  }

  if (core.status === "unavailable") {
    return (
      <div {...stylex.props(styles.centered)}>
        <Text tone="muted">
          Honk Core is unavailable. Run inside the desktop app with a preload that exposes
          getHonkCoreEndpoint.
        </Text>
      </div>
    );
  }

  if (state.step === "opening" || state.step === "trusting" || state.step === "creating") {
    return (
      <div {...stylex.props(styles.centered)}>
        <div {...stylex.props(styles.waiting)}>
          <Spinner size="sm" />
          {state.step === "opening"
            ? "Opening workspace"
            : state.step === "trusting"
              ? "Recording trust"
              : "Starting chat"}
        </div>
        <div {...stylex.props(styles.mono)}>{state.directory}</div>
      </div>
    );
  }

  if (state.step === "trust") {
    // Core refused the untrusted directory (spec/core.md trust invariant).
    // Consent is an explicit user decision; declining walks away cleanly.
    return (
      <TrustDialog
        directory={state.directory}
        onTrust={start.acceptTrust}
        onDecline={start.declineTrust}
      />
    );
  }

  if (state.step === "ready") {
    return (
      <div {...stylex.props(styles.centered)}>
        <div {...stylex.props(styles.workspaceRow)}>
          <Icon icon={IconFolder1} size="sm" tone="faint" />
          <Text>{basename(state.directory)}</Text>
          <span {...stylex.props(styles.workspacePath)}>{state.directory}</span>
          <Badge tone="ok" size="sm">
            trusted
          </Badge>
        </div>
        <ModelSelect options={start.modelOptions} value={start.model} onChange={start.setModel} />
        <Button variant="primary" onClick={start.startChat}>
          Start chat
        </Button>
        <Button size="sm" variant="quiet" onClick={start.closeWorkspace}>
          Switch workspace
        </Button>
        <ProviderSetupCard providers={start.providerSetups} onAddKey={start.addKey} />
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.centered)}>
      <Text size="lg" weight="semibold">
        Open a workspace
      </Text>
      <Text size="sm" tone="muted">
        Honk works inside a folder you choose. Nothing is read until you trust it.
      </Text>
      {state.error !== null && <div {...stylex.props(styles.errorText)}>{state.error}</div>}
      <DirectoryPicker
        recentDirectories={start.recentDirectories}
        isPending={false}
        onSelect={start.openDirectory}
        {...(start.canBrowse ? { onBrowse: start.browseForDirectory } : {})}
      />
    </div>
  );
}
