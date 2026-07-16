import * as React from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  openCodeMessageID,
  openCodeServerKey,
  openCodeSessionKey,
  openCodeSessionRef,
  type Message,
  type OpenCodeClient,
  type OpenCodePermissionRequest,
  type OpenCodePromptFileAttachment,
  type OpenCodeQuestionRequest,
  type OpenCodeSessionInfo,
  type OpenCodeSessionRef,
  type Part,
} from "@honk/opencode";
import { Picker } from "@honk/ui";
import { TextField } from "@honk/ui/text-field";

import { Conversation } from "./conversation";
import { useRemote } from "./remote-context";
import { ActionButton, DetailText, EmptyState, LoadingState, Page, useHonkTheme } from "./ui";

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RELOAD_DEBOUNCE_MS = 150;
const RECONNECT_DELAY_MS = 1_500;

type SessionConnection = "connecting" | "live" | "reconnecting";

interface ComposerImage {
  readonly id: string;
  readonly uri: string;
  readonly file: OpenCodePromptFileAttachment;
}

interface SessionViewState {
  readonly info: OpenCodeSessionInfo;
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly running: boolean;
  readonly questions: readonly OpenCodeQuestionRequest[];
  readonly permissions: readonly OpenCodePermissionRequest[];
}

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
  const ref = React.useMemo(
    () =>
      serverKey.length === 0 || sessionId.length === 0
        ? null
        : openCodeSessionRef(openCodeServerKey(serverKey), sessionId),
    [serverKey, sessionId],
  );
  const client = ref === null ? null : remote.clientFor(ref.server);
  const indexedInfo =
    ref === null
      ? null
      : (remote.sessions.find(
          (session) => session.ref.server === ref.server && session.ref.sessionID === ref.sessionID,
        )?.info ?? null);
  const [state, setState] = React.useState<SessionViewState | null>(null);
  const [connection, setConnection] = React.useState<SessionConnection>("connecting");
  const [agents, setAgents] = React.useState<readonly string[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [draftReady, setDraftReady] = React.useState(false);
  const [attachments, setAttachments] = React.useState<readonly ComposerImage[]>([]);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);
  const nearBottomRef = React.useRef(true);
  const sessionDirectory = state?.info.location.directory ?? null;
  const sessionAgent = state?.info.agent ?? null;

  React.useEffect(() => {
    if (client === null || ref === null) return;
    setState(null);
    setConnection("connecting");
    const controller = new AbortController();
    let disposed = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const reload = (): void => {
      if (disposed || reloadTimer !== null) return;
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void loadSession(client, ref)
          .then((next) => {
            if (!disposed) setState(next);
          })
          .catch((cause: unknown) => {
            if (!disposed) setError(errorMessage(cause, "The session could not be refreshed."));
          });
      }, RELOAD_DEBOUNCE_MS);
    };

    const wait = (): Promise<void> =>
      new Promise((resolve) => {
        const timeout = setTimeout(done, RECONNECT_DELAY_MS);
        function done(): void {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", done);
          resolve();
        }
        controller.signal.addEventListener("abort", done, { once: true });
      });

    void (async () => {
      while (!disposed) {
        try {
          const next = await loadSession(client, ref);
          if (disposed) return;
          setState(next);
          setConnection("live");
          for await (const _event of client.sessions.events(ref, undefined, controller.signal)) {
            if (disposed) return;
            reload();
          }
          if (disposed) return;
          setConnection("reconnecting");
        } catch (cause) {
          if (disposed) return;
          setConnection("reconnecting");
          setError(errorMessage(cause, "The session connection failed."));
        }
        await wait();
      }
    })();

    return () => {
      disposed = true;
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      controller.abort();
    };
  }, [client, ref]);

  React.useEffect(() => {
    if (indexedInfo === null) return;
    setState((current) => {
      if (current === null || indexedInfo.time.updated < current.info.time.updated) return current;
      return current.info === indexedInfo ? current : { ...current, info: indexedInfo };
    });
  }, [indexedInfo]);

  React.useEffect(() => {
    let active = true;
    setDraftReady(false);
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
      const selected: ComposerImage[] = [];
      for (const asset of result.assets) {
        if (asset.base64 === null || asset.base64 === undefined) continue;
        const sizeBytes = asset.fileSize ?? Math.max(1, Math.floor((asset.base64.length * 3) / 4));
        if (sizeBytes > MAX_IMAGE_BYTES) {
          throw new Error(`${asset.fileName ?? "An image"} is larger than 10 MiB.`);
        }
        const mime = asset.mimeType ?? "image/jpeg";
        const id = Crypto.randomUUID();
        selected.push({
          id,
          uri: asset.uri,
          file: {
            uri: `data:${mime};base64,${asset.base64}`,
            name: asset.fileName ?? `image-${id}.jpg`,
          },
        });
      }
      setAttachments((current) => [...current, ...selected].slice(0, MAX_ATTACHMENTS));
      if (selected.length > 0) await Haptics.selectionAsync();
    } catch (cause) {
      setError(errorMessage(cause, "Images could not be attached."));
    }
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if ((text === "" && attachments.length === 0) || sending) return;
    setSending(true);
    setError(null);
    try {
      if (agent !== null && agent !== state.info.agent) {
        await client.sessions.switchAgent(ref, agent);
      }
      await client.sessions.prompt(ref, {
        id: openCodeMessageID(Crypto.randomUUID()),
        prompt: {
          text,
          ...(attachments.length > 0
            ? { files: attachments.map((attachment) => attachment.file) }
            : {}),
        },
      });
      setDraft("");
      setAttachments([]);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      nearBottomRef.current = true;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (cause) {
      setError(errorMessage(cause, "The message could not be sent."));
    } finally {
      setSending(false);
    }
  };

  const interrupt = async (): Promise<void> => {
    setError(null);
    try {
      await client.sessions.interrupt(ref);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 96;
  };

  const running = state.running;

  return (
    <Page>
      <Stack.Title>{state.info.title}</Stack.Title>
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
          {running ? (
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
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={theme.metrics.interaction.touchTarget}
        style={styles.fill}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.content,
            {
              gap: theme.metrics.space.sectionGap,
              padding: theme.metrics.space.screenGutter,
            },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (nearBottomRef.current) scrollRef.current?.scrollToEnd({ animated: true });
          }}
          onScroll={onScroll}
          scrollEventThrottle={32}
        >
          {connection === "live" ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.warnFg }}>
              Connection {connection}
            </DetailText>
          )}
          {state.messages.length === 0 &&
          state.questions.length === 0 &&
          state.permissions.length === 0 ? (
            <EmptyState
              body="Send the first instruction to start this session."
              title="Ready when you are"
            />
          ) : (
            <Conversation
              messages={state.messages}
              onAnswerPermission={answerPermission}
              onAnswerQuestion={answerQuestion}
              onRejectQuestion={rejectQuestion}
              permissions={state.permissions}
              parts={state.parts}
              questions={state.questions}
            />
          )}
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              backgroundColor: theme.colors.bgBase,
              gap: theme.metrics.space.contentGap,
              paddingBottom: Math.max(theme.metrics.space.contentGap, insets.bottom),
              paddingHorizontal: theme.metrics.space.screenGutter,
              paddingTop: theme.metrics.space.contentGap,
            },
          ]}
        >
          {attachments.length === 0 ? null : (
            <View style={[styles.rail, { gap: theme.metrics.space.compactGap }]}>
              {attachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentPreview}>
                  <Image
                    accessibilityLabel={attachment.file.name ?? "Attached image"}
                    source={{ uri: attachment.uri }}
                    style={{
                      borderRadius: theme.metrics.radius.control,
                      height: theme.metrics.composer.attachmentSize,
                      width: theme.metrics.composer.attachmentSize,
                    }}
                  />
                  <Pressable
                    accessibilityLabel={`Remove ${attachment.file.name ?? "image"}`}
                    accessibilityRole="button"
                    onPress={() =>
                      setAttachments((current) =>
                        current.filter((candidate) => candidate.id !== attachment.id),
                      )
                    }
                    style={[
                      styles.removeAttachment,
                      {
                        backgroundColor: theme.colors.errBg,
                        borderRadius: theme.metrics.radius.pill,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.colors.errFg,
                        fontWeight: theme.metrics.font.weightSemibold,
                      }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {agents.length === 0 || agent === null ? null : (
            <Picker.Root value={agent} onValueChange={setAgent}>
              <Picker.Trigger size="sm" accessibilityLabel="Agent">
                <DetailText>{agent}</DetailText>
              </Picker.Trigger>
              <Picker.Popup label="Agent">
                {agents.map((candidate) => (
                  <Picker.Option key={candidate} value={candidate} label={candidate} />
                ))}
              </Picker.Popup>
            </Picker.Root>
          )}

          <TextField
            autoCapitalize="sentences"
            label="Message"
            labelHidden
            leading={
              <ActionButton
                accessibilityLabel="Add image"
                disabled={attachments.length >= MAX_ATTACHMENTS}
                label="+"
                onPress={() => void chooseImages()}
                size="compact"
                tone="neutral"
              />
            }
            minRows={1}
            multiline
            onChangeText={setDraft}
            placeholder={running ? "Add the next instruction" : "Ask Honk"}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmit={() => void send()}
            trailing={
              <ActionButton
                disabled={draft.trim() === "" && attachments.length === 0}
                label={running ? "Queue" : "Send"}
                onPress={() => void send()}
                pending={sending}
                size="compact"
              />
            }
            value={draft}
          />
          {error === null ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.errFg }}>
              {error}
            </DetailText>
          )}
        </View>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  attachmentPreview: {
    position: "relative",
  },
  composer: {
    width: "100%",
  },
  content: {
    flexGrow: 1,
  },
  fill: {
    flex: 1,
  },
  removeAttachment: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: -8,
    top: -8,
    width: 28,
  },
  rail: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
});
