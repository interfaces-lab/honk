import * as React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import type { LegendListRef } from "@legendapp/list/react-native";
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from "@legendapp/list/keyboard";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "@honk/ui";
import {
  openCodeMessageID,
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import { ChatComposer, type ComposerImage, type ComposerSelection } from "./chat-composer";
import { useComposerDraft } from "./composer/draft-store";
import { PromptMenu, usePromptSuggestions } from "./composer/prompt-menu";
import { applyPromptSuggestion, detectPromptToken } from "./composer/prompt-token";
import { removeThreadMessage, useThreadQueue, type QueueItem } from "./composer/queue-store";
import { createComposerQueueDrain } from "./composer/submission";
import { ConnectionUnavailableState } from "./connection-unavailable-state";
import { ConversationRow } from "./conversation";
import { buildConversationItems, type ConversationItem } from "./conversation-items";
import { MarkdownText } from "./markdown";
import { useRemote } from "./remote-context";
import {
  applySessionEvent,
  eventSessionID,
  optimisticTurn,
  type SessionViewState,
} from "./thread-state";
import { BodyText, DetailText, EmptyState, LoadingState, Page, useHonkTheme } from "./ui";

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ANCHOR_MAX_SIZE = 160;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

async function loadSession(
  client: OpenCodeClient,
  ref: OpenCodeSessionRef,
): Promise<SessionViewState> {
  const [transcript, active, questions, permissions] = await Promise.all([
    client.sessions.transcript(ref),
    client.sessions.active(),
    client.sessions.questions(ref).catch(() => []),
    client.sessions.permissions(ref).catch(() => []),
  ]);
  return {
    info: transcript.info,
    messages: transcript.messages,
    parts: transcript.parts,
    running: active[ref.sessionID] !== undefined,
    questions,
    permissions,
  };
}

export function ThreadScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ serverKey: string; sessionId: string }>();
  const remote = useRemote();
  const serverKey = params.serverKey ?? "";
  const sessionId = params.sessionId ?? "";
  const ref =
    serverKey.length === 0 || sessionId.length === 0
      ? null
      : openCodeSessionRef(openCodeServerKey(serverKey), sessionId);
  const client = ref === null ? null : remote.clientFor(ref.server);
  const indexedSession =
    ref === null
      ? null
      : (remote.sessions.find(
          (session) => session.ref.server === ref.server && session.ref.sessionID === ref.sessionID,
        ) ?? null);
  const indexedInfo = indexedSession?.info ?? null;
  const serverStatus =
    ref === null
      ? "connecting"
      : (remote.servers.find((server) => server.descriptor.key === ref.server)?.status ??
        "connecting");
  const [state, setState] = React.useState<SessionViewState | null>(null);
  const [agents, setAgents] = React.useState<readonly string[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [draft, setDraft] = useComposerDraft(ref);
  const [caret, setCaret] = React.useState<ComposerSelection>({ start: 0, end: 0 });
  const [forcedCaret, setForcedCaret] = React.useState<ComposerSelection | null>(null);
  const [attachments, setAttachments] = React.useState<readonly ComposerImage[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [anchorIndex, setAnchorIndex] = React.useState<number | undefined>();
  const [animateMessageID, setAnimateMessageID] = React.useState<string | null>(null);
  const [reasoning, setReasoning] = React.useState("");
  const listRef = React.useRef<LegendListRef>(null);
  const composerRef = React.useRef<View>(null);
  const reasoningSheetRef = React.useRef<TrueSheet>(null);
  const sessionInfo =
    state === null || indexedInfo === null || indexedInfo.time.updated < state.info.time.updated
      ? (state?.info ?? indexedInfo)
      : indexedInfo;
  const sessionDirectory = sessionInfo?.location.directory ?? null;
  const sessionAgent = sessionInfo?.agent ?? null;
  const items =
    state === null
      ? []
      : buildConversationItems({
          messages: state.messages,
          parts: state.parts,
          permissions: state.permissions,
          questions: state.questions,
        });
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
    120,
  );
  const [queueDrain] = React.useState(createComposerQueueDrain);
  const queued = useThreadQueue(ref);
  // A range selection has no single insertion point, so there is no honest token to complete.
  const promptToken =
    caret.start === caret.end && caret.start <= draft.length
      ? detectPromptToken(draft, caret.start)
      : null;
  const suggestions = usePromptSuggestions({
    client,
    directory: sessionDirectory,
    token: promptToken,
  });

  React.useEffect(() => {
    if (client === null || ref === null) return;
    let disposed = false;

    const refreshRequests = (): void => {
      void Promise.all([
        client.sessions.questions(ref).catch(() => []),
        client.sessions.permissions(ref).catch(() => []),
      ]).then(([questions, permissions]) => {
        if (disposed) return;
        setState((current) => (current === null ? null : { ...current, questions, permissions }));
      });
    };

    void loadSession(client, ref)
      .then((next) => {
        if (!disposed) setState(next);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(errorMessage(cause, "The session could not be opened."));
      });

    const unsubscribe = remote.subscribeEvents(ref.server, (event) => {
      if (eventSessionID(event) !== ref.sessionID) return;
      setState((current) => (current === null ? current : applySessionEvent(current, event)));
      if (event.type.startsWith("question.") || event.type.startsWith("permission.")) {
        refreshRequests();
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, ref, remote.subscribeEvents]);

  React.useEffect(() => {
    if (client === null || ref === null || serverStatus !== "live") return;
    let disposed = false;
    void loadSession(client, ref).then((next) => {
      if (!disposed) setState(next);
    });
    return () => {
      disposed = true;
    };
  }, [client, ref, serverStatus]);

  React.useEffect(() => {
    let active = true;
    if (client === null || sessionDirectory === null) return;
    void client.agents
      .list({ directory: sessionDirectory })
      .then((result) => {
        if (!active) return;
        const primaryAgents = result.data
          .filter((candidate) => candidate.mode !== "subagent" && !candidate.hidden)
          .map((candidate) => candidate.id);
        setAgents(primaryAgents);
        setAgent(
          (current) =>
            current ??
            sessionAgent ??
            primaryAgents.find((candidate) => candidate === "build") ??
            primaryAgents[0] ??
            null,
        );
      })
      .catch(() => {
        // Agent selection is optional; the session's pinned agent still applies.
      });
    return () => {
      active = false;
    };
  }, [client, sessionAgent, sessionDirectory]);

  // Every queued message reaches the session through here, whether it drained straight away or waited
  // for the turn in front of it. Resolving `false` — never rejecting — is what puts it back in the tray.
  const dispatchQueueItem = React.useCallback(
    async (item: QueueItem): Promise<boolean> => {
      if (client === null || ref === null || state === null) return false;
      const messageID = openCodeMessageID(Crypto.randomUUID());
      const optimistic = optimisticTurn(
        sessionInfo ?? state.info,
        messageID,
        item.text,
        item.attachments,
      );
      setError(null);
      setAnchorIndex(state.messages.length);
      setAnimateMessageID(messageID);
      setState((current) =>
        current === null
          ? null
          : {
              ...current,
              messages: [...current.messages, optimistic.message],
              parts: [...current.parts, ...optimistic.parts],
              running: true,
            },
      );
      requestAnimationFrame(() => {
        void scrollMessageToEnd({ animated: true, closeKeyboard: false });
      });

      try {
        if (item.agent !== undefined && item.agent !== sessionInfo?.agent) {
          await client.sessions.switchAgent(ref, item.agent);
        }
        await client.sessions.prompt(ref, {
          id: messageID,
          prompt: {
            text: item.text,
            ...(item.attachments.length === 0
              ? {}
              : { files: item.attachments.map((attachment) => attachment.file) }),
          },
        });
        if (process.env.EXPO_OS === "ios") {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        setState(await loadSession(client, ref));
        return true;
      } catch (cause) {
        // Rolling the optimistic turn back drops `running` to false, which is the same edge a
        // finished turn produces. Suppressing it keeps the restored message in the tray instead
        // of retrying it.
        queueDrain.suppressNextDrain();
        setState((current) =>
          current === null
            ? null
            : {
                ...current,
                messages: current.messages.filter((message) => message.id !== messageID),
                parts: current.parts.filter((part) => part.messageID !== messageID),
                running: false,
              },
        );
        setAnchorIndex(undefined);
        setAnimateMessageID(null);
        setError(errorMessage(cause, "The message could not be sent."));
        return false;
      }
    },
    [client, queueDrain, ref, scrollMessageToEnd, sessionInfo, state],
  );

  const running = state?.running ?? false;
  React.useEffect(() => {
    if (ref === null) return;
    void queueDrain.syncRunning({ ref, running, dispatch: dispatchQueueItem });
  }, [dispatchQueueItem, queueDrain, ref, running]);

  if (ref === null) return <Redirect href="/(tabs)/home" />;
  const server =
    remote.servers.find((candidate) => candidate.descriptor.key === ref.server) ?? null;
  if (server === null) return <Redirect href="/(tabs)/home" />;
  if (client === null) {
    return (
      <Page>
        <Stack.Title>{indexedInfo?.title ?? "Session"}</Stack.Title>
        <ConnectionUnavailableState
          fallbackDetail={`Honk will reopen this session when ${server.descriptor.label} is reachable.`}
          server={server}
          {...(indexedSession?.cached === true
            ? {
                detail: `Reconnect ${server.descriptor.label} to load this conversation.`,
                title: "Messages not cached",
              }
            : {})}
        />
      </Page>
    );
  }
  if (state === null) return <LoadingState label="Opening session…" />;

  const chooseImages = async (): Promise<void> => {
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setError(`A message can include up to ${MAX_ATTACHMENTS} images.`);
      return;
    }
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        base64: true,
        mediaTypes: "images",
        quality: 0.9,
        selectionLimit: remaining,
      });
      if (result.canceled) return;
      const selected = result.assets.flatMap<ComposerImage>((asset) => {
        if (asset.base64 === null || asset.base64 === undefined) return [];
        const sizeBytes = asset.fileSize ?? Math.max(1, Math.floor((asset.base64.length * 3) / 4));
        if (sizeBytes > MAX_IMAGE_BYTES) {
          throw new Error(`${asset.fileName ?? "An image"} is larger than 10 MiB.`);
        }
        const mime = asset.mimeType ?? "image/jpeg";
        const id = Crypto.randomUUID();
        return [
          {
            id,
            uri: asset.uri,
            file: {
              uri: `data:${mime};base64,${asset.base64}`,
              name: asset.fileName ?? `image-${id}.jpg`,
            },
          },
        ];
      });
      setAttachments((current) => [...current, ...selected].slice(0, MAX_ATTACHMENTS));
      if (selected.length > 0 && process.env.EXPO_OS === "ios") await Haptics.selectionAsync();
    } catch (cause) {
      setError(errorMessage(cause, "Images could not be attached."));
    }
  };

  // One action, whether the session is idle or working: the message always joins the queue, and an
  // idle session drains it immediately so the control still behaves like a plain send.
  const send = (): void => {
    const text = draft.trim();
    if (text === "" && attachments.length === 0) return;
    const submitted = attachments;
    setDraft("");
    setAttachments([]);
    void queueDrain.submit(
      { ref, running: state.running, dispatch: dispatchQueueItem },
      { text, attachments: submitted, ...(agent === null ? {} : { agent }) },
    );
  };

  const interrupt = async (): Promise<void> => {
    // The turn ending because the user stopped it must not fire the next queued message at the agent.
    queueDrain.suppressNextDrain();
    try {
      await client.sessions.interrupt(ref);
      if (process.env.EXPO_OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (cause) {
      toast.error("Stop failed", {
        description: errorMessage(cause, "The session could not be stopped."),
      });
    }
  };

  const answerQuestion = async (
    requestId: string,
    answers: readonly (readonly string[])[],
  ): Promise<void> => {
    await client.sessions.replyQuestion(ref, requestId, {
      answers: answers.map((answer) => [...answer]),
    });
    setState((current) =>
      current === null
        ? null
        : {
            ...current,
            questions: current.questions.filter((request) => request.id !== requestId),
          },
    );
  };

  const rejectQuestion = async (requestId: string): Promise<void> => {
    await client.sessions.rejectQuestion(ref, requestId);
    setState((current) =>
      current === null
        ? null
        : {
            ...current,
            questions: current.questions.filter((request) => request.id !== requestId),
          },
    );
  };

  const answerPermission = async (
    requestId: string,
    reply: "once" | "always" | "reject",
  ): Promise<void> => {
    await client.sessions.replyPermission(ref, requestId, reply);
    setState((current) =>
      current === null
        ? null
        : {
            ...current,
            permissions: current.permissions.filter((request) => request.id !== requestId),
          },
    );
  };

  const actions = {
    onAnswerPermission: answerPermission,
    onAnswerQuestion: answerQuestion,
    onOpenReasoning: (text: string) => {
      setReasoning(text);
      requestAnimationFrame(() => void reasoningSheetRef.current?.present());
    },
    onRejectQuestion: rejectQuestion,
  };
  const renderItem = ({ item }: { readonly item: ConversationItem }): React.ReactElement => (
    <View style={{ paddingBottom: theme.metrics.space.rowGap }}>
      <ConversationRow actions={actions} animateMessageID={animateMessageID} item={item} />
    </View>
  );

  return (
    <Page>
      <Stack.Title>{sessionInfo?.title ?? state.info.title}</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.MenuAction
            icon="slider.horizontal.3"
            onPress={() =>
              router.push({
                pathname: "/session/[serverKey]/[sessionId]/settings",
                params: { serverKey: ref.server, sessionId: ref.sessionID },
              })
            }
          >
            Session details
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <KeyboardGestureArea interpolator="ios" offset={60} style={styles.fill}>
        <KeyboardAwareLegendList
          alignItemsAtEnd
          {...(anchorIndex === undefined
            ? {}
            : {
                anchoredEndSpace: {
                  anchorIndex,
                  anchorMaxSize: ANCHOR_MAX_SIZE,
                  anchorOffset: theme.metrics.space.screenGutter,
                  onSizeChanged: (size: number) => {
                    if (size === 0) setAnchorIndex(undefined);
                  },
                },
              })}
          contentContainerStyle={{
            paddingHorizontal: theme.metrics.space.screenGutter,
            paddingTop: theme.metrics.space.screenGutter,
          }}
          contentInsetAdjustmentBehavior="automatic"
          contentInsetEndAdjustment={contentInsetEndAdjustment}
          data={items}
          dataKey={openCodeSessionKey(ref)}
          estimatedItemSize={240}
          freeze={freeze}
          initialScrollAtEnd
          keyboardDismissMode="interactive"
          keyboardOffset={insets.bottom}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <EmptyState
              body="Send the first instruction to start this session."
              title="Ready when you are"
            />
          }
          ListHeaderComponent={
            serverStatus === "live" ? null : (
              <DetailText
                accessibilityLiveRegion="polite"
                style={{
                  color: theme.colors.warnFg,
                  paddingBottom: theme.metrics.space.contentGap,
                }}
              >
                Connection {serverStatus}
              </DetailText>
            )
          }
          maintainScrollAtEnd={{
            animated: false,
            on: { dataChange: true, itemLayout: true },
          }}
          maintainVisibleContentPosition={{ data: true, size: true }}
          recycleItems
          ref={listRef}
          renderItem={renderItem}
          style={styles.fill}
        />
      </KeyboardGestureArea>

      {/*
        The menu and the composer are measured together: `useKeyboardChatComposerInset` sizes the
        list's bottom inset from this view, so anything that rides above the input has to be inside
        it or it covers the last rows of the conversation.
      */}
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View ref={composerRef} onLayout={onComposerLayout}>
          <PromptMenu
            items={suggestions.items}
            onSelect={(selection) => {
              const next = applyPromptSuggestion(draft, selection.token, selection.insert);
              setDraft(next.text);
              setCaret({ start: next.cursor, end: next.cursor });
              setForcedCaret({ start: next.cursor, end: next.cursor });
            }}
            status={suggestions.status}
            token={promptToken}
          />
          <ChatComposer
            agent={agent}
            agents={agents}
            attachments={attachments}
            bottomInset={insets.bottom}
            draft={draft}
            error={error}
            maxAttachments={MAX_ATTACHMENTS}
            onAgentChange={setAgent}
            onAttach={() => void chooseImages()}
            onChangeDraft={(text) => {
              // Typing always releases a caret forced by an accepted suggestion, even on a platform
              // that does not report the programmatic selection back.
              setForcedCaret(null);
              setDraft(text);
            }}
            onRemoveAttachment={(id) =>
              setAttachments((current) => current.filter((attachment) => attachment.id !== id))
            }
            onRemoveQueued={(id) => removeThreadMessage(ref, id)}
            onSelectionChange={(selection) => {
              setCaret(selection);
              setForcedCaret(null);
            }}
            onSend={send}
            onStop={() => void interrupt()}
            queued={queued}
            running={state.running}
            selection={forcedCaret}
          />
        </View>
      </KeyboardStickyView>

      <TrueSheet
        ref={reasoningSheetRef}
        cornerRadius={theme.metrics.radius.panel}
        detents={["auto", 1]}
        grabber
        maxContentHeight={620}
        scrollable
      >
        <ScrollView
          contentContainerStyle={{
            gap: theme.metrics.space.rowGap,
            padding: theme.metrics.space.screenGutter,
          }}
        >
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Reasoning</BodyText>
          <MarkdownText markdown={reasoning} />
        </ScrollView>
      </TrueSheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
