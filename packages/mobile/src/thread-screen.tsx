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
import * as SecureStore from "expo-secure-store";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  openCodeMessageID,
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  type OpenCodeClient,
  type OpenCodeSessionRef,
} from "@honk/opencode";

import { ChatComposer, type ComposerImage } from "./chat-composer";
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

interface StoredDraft {
  readonly sessionKey: string;
  readonly text: string;
}

function draftKey(ref: OpenCodeSessionRef): string {
  let hash = 0x811c9dc5;
  for (const character of openCodeSessionKey(ref)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `honk.mobile.opencode.draft.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function decodeDraft(raw: string | null, ref: OpenCodeSessionRef): string {
  if (raw === null) return "";
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
    const sessionKey = Reflect.get(value, "sessionKey");
    const text = Reflect.get(value, "text");
    return sessionKey === openCodeSessionKey(ref) && typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

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
  const indexedInfo =
    ref === null
      ? null
      : (remote.sessions.find(
          (session) => session.ref.server === ref.server && session.ref.sessionID === ref.sessionID,
        )?.info ?? null);
  const serverStatus =
    ref === null
      ? "connecting"
      : (remote.servers.find((server) => server.descriptor.key === ref.server)?.status ??
        "connecting");
  const [state, setState] = React.useState<SessionViewState | null>(null);
  const [agents, setAgents] = React.useState<readonly string[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [draftReady, setDraftReady] = React.useState(false);
  const [attachments, setAttachments] = React.useState<readonly ComposerImage[]>([]);
  const [sending, setSending] = React.useState(false);
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
    if (ref === null) return;
    void SecureStore.getItemAsync(draftKey(ref)).then((saved) => {
      if (!active) return;
      setDraft(decodeDraft(saved, ref));
      setDraftReady(true);
    });
    return () => {
      active = false;
    };
  }, [ref]);

  React.useEffect(() => {
    if (!draftReady || ref === null) return;
    const timeout = setTimeout(() => {
      const key = draftKey(ref);
      if (draft === "") void SecureStore.deleteItemAsync(key);
      else {
        const value: StoredDraft = { sessionKey: openCodeSessionKey(ref), text: draft };
        void SecureStore.setItemAsync(key, JSON.stringify(value));
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [draft, draftReady, ref]);

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

  if (ref === null || client === null) return <Redirect href="/connect" />;
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

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if ((text === "" && attachments.length === 0) || sending) return;
    const submittedAttachments = attachments;
    const messageID = openCodeMessageID(Crypto.randomUUID());
    const optimistic = optimisticTurn(
      sessionInfo ?? state.info,
      messageID,
      text,
      submittedAttachments,
    );
    setSending(true);
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
    setDraft("");
    setAttachments([]);
    requestAnimationFrame(() => {
      void scrollMessageToEnd({ animated: true, closeKeyboard: false });
    });

    try {
      if (agent !== null && agent !== sessionInfo?.agent) {
        await client.sessions.switchAgent(ref, agent);
      }
      await client.sessions.prompt(ref, {
        id: messageID,
        prompt: {
          text,
          ...(submittedAttachments.length === 0
            ? {}
            : { files: submittedAttachments.map((attachment) => attachment.file) }),
        },
      });
      if (process.env.EXPO_OS === "ios") {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const reconciled = await loadSession(client, ref);
      setState(reconciled);
      setSending(false);
    } catch (cause) {
      setState((current) =>
        current === null
          ? null
          : {
              ...current,
              messages: current.messages.filter((message) => message.id !== messageID),
              parts: current.parts.filter((part) => part.messageID !== messageID),
            },
      );
      setDraft(text);
      setAttachments(submittedAttachments);
      setAnchorIndex(undefined);
      setAnimateMessageID(null);
      setError(errorMessage(cause, "The message could not be sent."));
      setSending(false);
    }
  };

  const interrupt = async (): Promise<void> => {
    setError(null);
    try {
      await client.sessions.interrupt(ref);
      if (process.env.EXPO_OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (cause) {
      setError(errorMessage(cause, "The session could not be stopped."));
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
          {state.running ? (
            <Stack.Toolbar.MenuAction
              destructive
              icon="stop.circle"
              onPress={() => void interrupt()}
            >
              Stop session
            </Stack.Toolbar.MenuAction>
          ) : null}
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

      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <ChatComposer
          ref={composerRef}
          agent={agent}
          agents={agents}
          attachments={attachments}
          bottomInset={insets.bottom}
          draft={draft}
          error={error}
          maxAttachments={MAX_ATTACHMENTS}
          onAgentChange={setAgent}
          onAttach={() => void chooseImages()}
          onChangeDraft={setDraft}
          onLayout={onComposerLayout}
          onRemoveAttachment={(id) =>
            setAttachments((current) => current.filter((attachment) => attachment.id !== id))
          }
          onSend={() => void send()}
          running={state.running}
          sending={sending}
        />
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
