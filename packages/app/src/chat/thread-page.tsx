// The chat thread: one Honk Core session, rendered natively from Pi values.
// Deep-linkable and restart-safe — the core restores stored sessions lazily
// on the first command that names them.

import { Spinner, Text } from "@honk/ui";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import * as React from "react";

import { Session } from "@honk/core/session";

import { useConversationDensity } from "../app-settings-store";
import { conversationItems, tickerOf } from "./chat-model";
import { useCoreSession } from "./chat-store";
import { ChatComposer } from "./composer";
import { ChatTranscript } from "./transcript";

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
});

export function ChatThreadPage(): React.ReactElement {
  const params = useParams({ from: "/v2/$sessionId" });
  const sessionId = Session.SessionId.make(params.sessionId);
  const { state, prompt, steer, stop } = useCoreSession(sessionId);
  const density = useConversationDensity();

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

  const running = state.status === "running";

  return (
    <div data-thread-panel="" {...stylex.props(styles.root)}>
      <ChatTranscript
        items={conversationItems(state.entries, state.streamingMessage, state.turns)}
        running={running}
        ticker={tickerOf(state)}
        density={density}
      />
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
