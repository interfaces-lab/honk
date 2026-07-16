import * as stylex from "@stylexjs/stylex";
import { openCodeLocationRef } from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import { spaceVars } from "@honk/ui/tokens.stylex";
import { useSearch } from "@tanstack/react-router";
import * as React from "react";

import { useAppSettings } from "./app-settings-store";
import { HomeComposer } from "./composer/home-composer";
import { actions as tabActions, newSessionTabKey, useNewSessionDraft } from "./tab-store";
import { useSessionInventoryWatchSelector } from "./use-sdk-watch";

// Match Home's composer measure. Bottom pad leaves room for model, folder, slash, and mention menus.
const NEW_SESSION_MAX_WIDTH = "720px";
const NEW_SESSION_BOTTOM_BIAS = "12vh";
const EMPTY_DIRECTORIES: readonly string[] = Object.freeze([]);

const styles = stylex.create({
  page: {
    boxSizing: "border-box",
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlockStart: spaceVars["--honk-space-panel-pad"],
    paddingBlockEnd: NEW_SESSION_BOTTOM_BIAS,
  },
  composer: {
    width: "100%",
    maxWidth: NEW_SESSION_MAX_WIDTH,
  },
});

function NewSessionPage(): React.ReactElement {
  const { draftId } = useSearch({ from: "/new-session" });
  const appSettings = useAppSettings();
  const recentDirectories = useSessionInventoryWatchSelector(
    (snapshot) => snapshot.state?.recentDirectories ?? EMPTY_DIRECTORIES,
  );
  const [pickedDirectory, setPickedDirectory] = React.useState<string | null>(null);
  const draftKey = newSessionTabKey(draftId);
  const draft = useNewSessionDraft(draftKey);
  const directory =
    pickedDirectory ??
    draft?.location.directory ??
    appSettings.defaultProjectDirectory ??
    undefined;
  const location =
    pickedDirectory === null && draft !== null
      ? draft.location
      : directory === undefined
        ? undefined
        : openCodeLocationRef({ directory });

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.composer)}>
        <HomeComposer
          autoFocus
          draftKey={draftKey}
          {...(location === undefined ? {} : { location })}
          {...(draft === null ? {} : { server: draft.server, target: draft.target })}
          recentDirectories={recentDirectories}
          onTargetChange={(target) => {
            tabActions.updateDraftTarget(draftKey, target);
          }}
          onDirectoryPicked={(path) => {
            setPickedDirectory(path);
            tabActions.updateDraftDirectory(draftKey, path);
            tabActions.setRepository(draftKey, { state: "ready", label: basename(path) });
          }}
        />
      </div>
    </main>
  );
}

export { NewSessionPage };
