// The chat composer: text in, prompt or steer out, stop while running.
// Deliberately smaller than the opencode composer — Honk Core has no modes,
// agents, attachments, or queue yet; capabilities appear here as core grows
// them, not as disabled chrome.

import { Button } from "@honk/ui";
import { borderVars, colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

const COMPOSER_MIN_HEIGHT = "72px";

const styles = stylex.create({
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: spaceVars["--honk-space-gutter"],
    boxSizing: "border-box",
    width: "100%",
    padding: spaceVars["--honk-space-panel-pad"],
  },
  input: {
    flexGrow: 1,
    minHeight: COMPOSER_MIN_HEIGHT,
    boxSizing: "border-box",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-field"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    backgroundColor: colorVars["--honk-color-bg-chrome"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    resize: "none",
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
});

export function ChatComposer({
  running,
  onPrompt,
  onSteer,
  onStop,
}: {
  readonly running: boolean;
  readonly onPrompt: (text: string) => Promise<void>;
  readonly onSteer: (text: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
}): React.ReactElement {
  const [draft, setDraft] = React.useState("");

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft("");
    // While a run is active the text steers it; otherwise it starts a turn.
    void (running ? onSteer(text) : onPrompt(text)).catch(() => undefined);
  };

  return (
    <form
      {...stylex.props(styles.composer)}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        {...stylex.props(styles.input)}
        value={draft}
        placeholder={running ? "Steer the run…" : "What can I help you build?"}
        aria-label="Message"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" variant="primary" size="sm">
          {running ? "Steer" : "Send"}
        </Button>
        {running && (
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => {
              void onStop();
            }}
          >
            Stop
          </Button>
        )}
      </div>
    </form>
  );
}
