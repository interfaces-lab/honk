// The chat thread: one Honk Core session, rendered natively from Pi values.
// Deep-linkable and restart-safe — the core restores stored sessions lazily
// on the first command that names them.

import { Spinner, Text } from "@honk/ui";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import * as React from "react";

import { Session } from "@honk/core/session";

import { useCoreSession } from "./chat-controller";
import { threadItems, tickerOf, turnViews } from "./chat-model";
import { ChatComposer } from "./composer";
import { ChatTranscript, TRANSCRIPT_MAX_WIDTH } from "./transcript";
import { TurnStatus } from "./turn-status";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  banner: {
    alignSelf: "center",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
  // Same column as the transcript so the ticker lines up with the messages.
  statusRail: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: TRANSCRIPT_MAX_WIDTH,
    marginInline: "auto",
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
});

export function ChatThreadPage(): React.ReactElement {
  const params = useParams({ from: "/v2/$sessionId" });
  const sessionId = Session.SessionId.make(params.sessionId);
  const { state, prompt, steer, stop } = useCoreSession(sessionId);

  if (state.sessionId === null) {
    return (
      <div {...stylex.props(styles.centered)}>
        {state.status === "failed" ? (
          <>
            <Text size="lg" weight="semibold">
              Chat unavailable
            </Text>
            <Text size="sm" tone="muted">
              {state.error ?? "Honk Core could not open this session."}
            </Text>
          </>
        ) : (
          <Spinner label="Opening chat" tone="muted" />
        )}
      </div>
    );
  }

  // Interim placement: the status surface sits above the composer until the
  // turn renderer (#12) moves it into each turn's header.
  const turns = turnViews(state.entries);
  const lastTurn = turns.at(-1);
  const running = state.status === "running";

  return (
    <div data-thread-panel="" {...stylex.props(styles.root)}>
      <ChatTranscript items={threadItems(state.entries, state.streamingMessage, state.turns)} />
      {(running || lastTurn !== undefined) && (
        <div {...stylex.props(styles.statusRail)}>
          <TurnStatus
            phase={running ? "running" : "settled"}
            ticker={tickerOf(state)}
            outcome={lastTurn?.outcome ?? "done"}
            durationMs={lastTurn?.durationMs ?? null}
          />
        </div>
      )}
      {state.status === "failed" && (
        <div {...stylex.props(styles.banner)}>{state.error ?? "Honk Core failed."}</div>
      )}
      {state.status === "disconnected" && (
        <div {...stylex.props(styles.banner)}>
          Honk Core disconnected. Your transcript remains available.
        </div>
      )}
      <ChatComposer
        running={state.status === "running"}
        onPrompt={prompt}
        onSteer={steer}
        onStop={stop}
      />
    </div>
  );
}
