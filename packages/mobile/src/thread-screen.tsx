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
import type {
  PermissionRequest,
  QuestionRequest,
  SendMessageFile,
  SidecarAgent,
  ThreadState,
  WatchStatus,
} from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { Conversation } from "./conversation";
import { useRemote } from "./remote-context";
import {
  ActionButton,
  ChoiceButton,
  DetailText,
  EmptyState,
  LoadingState,
  Page,
  useHonkTheme,
} from "./ui";

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface ComposerImage {
  readonly id: string;
  readonly uri: string;
  readonly file: SendMessageFile;
}

const draftKey = (threadId: string): string => `honk.mobile.draft.${threadId}`;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

export function ThreadScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ threadId: string }>();
  const threadId = params.threadId;
  const remote = useRemote();
  const [state, setState] = React.useState<ThreadState | null>(null);
  const [watchStatus, setWatchStatus] = React.useState<WatchStatus>("reconnecting");
  const [questions, setQuestions] = React.useState<readonly QuestionRequest[]>([]);
  const [permissions, setPermissions] = React.useState<readonly PermissionRequest[]>([]);
  const [agents, setAgents] = React.useState<readonly SidecarAgent[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [draftReady, setDraftReady] = React.useState(false);
  const [attachments, setAttachments] = React.useState<readonly ComposerImage[]>([]);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);
  const nearBottomRef = React.useRef(true);
  const threadSeq = state?.seq ?? null;
  const threadCwd = state?.cwd ?? null;
  const threadAgent = state?.summary.agent ?? null;

  React.useEffect(() => {
    const client = remote.client;
    if (client === null || threadId.length === 0) return;
    setState(null);
    const watch = client.threads.watch(threadId, {
      onChange: setState,
      onStatus: setWatchStatus,
    });
    return () => watch.close();
  }, [remote.client, threadId]);

  React.useEffect(() => {
    let active = true;
    setDraftReady(false);
    void SecureStore.getItemAsync(draftKey(threadId)).then((saved) => {
      if (!active) return;
      setDraft(saved ?? "");
      setDraftReady(true);
    });
    return () => {
      active = false;
    };
  }, [threadId]);

  React.useEffect(() => {
    if (!draftReady) return;
    const timeout = setTimeout(() => {
      const key = draftKey(threadId);
      if (draft === "") void SecureStore.deleteItemAsync(key);
      else void SecureStore.setItemAsync(key, draft);
    }, 250);
    return () => clearTimeout(timeout);
  }, [draft, draftReady, threadId]);

  React.useEffect(() => {
    let active = true;
    const client = remote.client;
    if (client === null || threadSeq === null) return;
    void Promise.all([client.threads.questions(threadId), client.threads.permissions(threadId)])
      .then(([nextQuestions, nextPermissions]) => {
        if (!active) return;
        setQuestions(nextQuestions);
        setPermissions(nextPermissions);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, "Pending requests could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [remote.client, threadId, threadSeq]);

  React.useEffect(() => {
    let active = true;
    const client = remote.client;
    if (client === null || threadCwd === null) return;
    void client
      .listAgents(threadCwd)
      .then((nextAgents) => {
        if (!active) return;
        const primaryAgents = nextAgents.filter((candidate) => candidate.mode !== "subagent");
        setAgents(primaryAgents);
        setAgent(
          (current) =>
            current ??
            threadAgent ??
            primaryAgents.find((candidate) => candidate.name === "build")?.name ??
            primaryAgents[0]?.name ??
            null,
        );
      })
      .catch(() => {
        // Agent selection is optional; the session's pinned agent still applies.
      });
    return () => {
      active = false;
    };
  }, [remote.client, threadAgent, threadCwd]);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (state === null) return <LoadingState label="Opening task…" />;

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
            filename: asset.fileName ?? `image-${id}.jpg`,
            mime,
            path: `data:${mime};base64,${asset.base64}`,
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
      await remote.client?.threads.send(threadId, {
        messageId: `mobile_${Crypto.randomUUID()}`,
        text,
        ...(agent !== null ? { agent } : {}),
        files: attachments.map((attachment) => attachment.file),
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
      await remote.client?.threads.interrupt(threadId);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (cause) {
      setError(errorMessage(cause, "The task could not be stopped."));
    }
  };

  const answerQuestion = async (
    requestId: string,
    answers: readonly (readonly string[])[],
  ): Promise<void> => {
    await remote.client?.threads.answerQuestion(threadId, requestId, answers);
    setQuestions((current) => current.filter((request) => request.id !== requestId));
  };

  const rejectQuestion = async (requestId: string): Promise<void> => {
    await remote.client?.threads.rejectQuestion(threadId, requestId);
    setQuestions((current) => current.filter((request) => request.id !== requestId));
  };

  const answerPermission = async (
    requestId: string,
    reply: "once" | "always" | "reject",
  ): Promise<void> => {
    await remote.client?.threads.answerPermission(threadId, requestId, reply);
    setPermissions((current) => current.filter((request) => request.id !== requestId));
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottomRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 96;
  };

  const running = state.summary.status === "running";

  return (
    <Page>
      <Stack.Title>{state.summary.title}</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.MenuAction
            icon="slider.horizontal.3"
            onPress={() => router.push({ pathname: "/task/[threadId]", params: { threadId } })}
          >
            Task settings
          </Stack.Toolbar.MenuAction>
          {running ? (
            <Stack.Toolbar.MenuAction
              destructive
              icon="stop.circle"
              onPress={() => void interrupt()}
            >
              Stop task
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
          {watchStatus === "live" ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.warnFg }}>
              Connection {watchStatus}
            </DetailText>
          )}
          {state.messages.length === 0 && questions.length === 0 && permissions.length === 0 ? (
            <EmptyState
              body="Send the first instruction to start this task."
              title="Ready when you are"
            />
          ) : (
            <Conversation
              onAnswerPermission={answerPermission}
              onAnswerQuestion={answerQuestion}
              onRejectQuestion={rejectQuestion}
              permissions={permissions}
              questions={questions}
              state={state}
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
                    accessibilityLabel={attachment.file.filename ?? "Attached image"}
                    source={{ uri: attachment.uri }}
                    style={{
                      borderRadius: theme.metrics.radius.control,
                      height: theme.metrics.composer.attachmentSize,
                      width: theme.metrics.composer.attachmentSize,
                    }}
                  />
                  <Pressable
                    accessibilityLabel={`Remove ${attachment.file.filename ?? "image"}`}
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

          {agents.length === 0 ? null : (
            <View style={[styles.rail, { gap: theme.metrics.space.compactGap }]}>
              {agents.map((candidate) => {
                const selected = candidate.name === agent;
                return (
                  <ChoiceButton
                    key={candidate.name}
                    label={candidate.name}
                    onPress={() => setAgent(candidate.name)}
                    selected={selected}
                  />
                );
              })}
            </View>
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
