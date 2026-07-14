import * as React from "react";
import {
  Image,
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
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MessageId,
  SEND_MAX_ATTACHMENTS,
  SEND_MAX_IMAGE_BYTES,
  ThreadId,
  type Delivery,
  type ImageAttachmentUpload,
  type InteractionMode,
} from "@honk/api/core/v1";
import type { ThreadState, WatchStatus } from "@honk/sdk";
import { TextField } from "@honk/ui/text-field";

import { Conversation } from "./conversation";
import { useRemote } from "./remote-context";
import { ActionButton, DetailText, LoadingState, Page, useHonkTheme } from "./ui";

const interactionModes: ReadonlyArray<{ readonly label: string; readonly value: InteractionMode }> = [
  { label: "Agent", value: "agent" },
  { label: "Ask", value: "ask" },
  { label: "Plan", value: "plan" },
  { label: "Debug", value: "debug" },
  { label: "Multitask", value: "multitask" },
];

const deliveryModes: ReadonlyArray<{ readonly label: string; readonly value: Delivery }> = [
  { label: "Queue", value: "queue" },
  { label: "Steer", value: "steer" },
  { label: "Interrupt", value: "interrupt" },
];

interface ComposerImage {
  readonly id: string;
  readonly uri: string;
  readonly upload: ImageAttachmentUpload;
}

const draftKey = (threadId: string): string => `honk.mobile.draft.${threadId}`;

const errorMessage = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;

export function ThreadScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ threadId: string }>();
  const remote = useRemote();
  const [state, setState] = React.useState<ThreadState | null>(null);
  const [watchStatus, setWatchStatus] = React.useState<WatchStatus>("reconnecting");
  const [draft, setDraft] = React.useState("");
  const [draftReady, setDraftReady] = React.useState(false);
  const [mode, setMode] = React.useState<InteractionMode>("agent");
  const [delivery, setDelivery] = React.useState<Delivery>("queue");
  const [attachments, setAttachments] = React.useState<ReadonlyArray<ComposerImage>>([]);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);
  const nearBottomRef = React.useRef(true);
  const markedReadRef = React.useRef<string | null>(null);
  const threadId = ThreadId.make(params.threadId);

  React.useEffect(() => {
    if (remote.client === null) return;
    setState(null);
    const watch = remote.client.threads.watch(threadId, {
      onChange: setState,
      onStatus: setWatchStatus,
    });
    return () => watch.close();
  }, [remote.client, threadId]);

  React.useEffect(() => {
    let active = true;
    setDraftReady(false);
    void SecureStore.getItemAsync(draftKey(String(threadId))).then((saved) => {
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
      const key = draftKey(String(threadId));
      if (draft === "") void SecureStore.deleteItemAsync(key);
      else void SecureStore.setItemAsync(key, draft);
    }, 250);
    return () => clearTimeout(timeout);
  }, [draft, draftReady, threadId]);

  React.useEffect(() => {
    if (state?.capabilities.steer !== true && delivery === "steer") setDelivery("queue");
  }, [delivery, state?.capabilities.steer]);

  React.useEffect(() => {
    const readableAt = state?.summary.readableAt ?? null;
    const client = remote.client;
    if (readableAt === null || client === null || markedReadRef.current === readableAt) return;
    const previous = remote.workspace?.uiState.threadReadAt[String(threadId)] ?? null;
    if (previous !== null && previous >= readableAt) {
      markedReadRef.current = readableAt;
      return;
    }
    markedReadRef.current = readableAt;
    void client.uiState.update({ threadRead: { threadId, readAt: readableAt } });
  }, [remote.client, remote.workspace?.uiState.threadReadAt, state?.summary.readableAt, threadId]);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (state === null) return <LoadingState label="Opening task…" />;

  const chooseImages = async (): Promise<void> => {
    const remaining = SEND_MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setError(`A message can include up to ${SEND_MAX_ATTACHMENTS} images.`);
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
      const selected: Array<ComposerImage> = [];
      for (const asset of result.assets) {
        if (asset.base64 === null || asset.base64 === undefined) continue;
        const sizeBytes = asset.fileSize ?? Math.max(1, Math.floor((asset.base64.length * 3) / 4));
        if (sizeBytes > SEND_MAX_IMAGE_BYTES) {
          throw new Error(`${asset.fileName ?? "An image"} is larger than 10 MiB.`);
        }
        const mimeType = asset.mimeType ?? "image/jpeg";
        const id = Crypto.randomUUID();
        selected.push({
          id,
          uri: asset.uri,
          upload: {
            name: asset.fileName ?? `image-${id}.jpg`,
            mimeType,
            sizeBytes,
            dataUrl: `data:${mimeType};base64,${asset.base64}`,
          },
        });
      }
      setAttachments((current) => [...current, ...selected].slice(0, SEND_MAX_ATTACHMENTS));
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
        messageId: MessageId.make(`mobile_${Crypto.randomUUID()}`),
        text,
        attachments: attachments.map((attachment) => attachment.upload),
        delivery: state.activeTurn === null ? "queue" : delivery,
        interactionMode: mode,
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

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearBottomRef.current =
      contentSize.height - (contentOffset.y + layoutMeasurement.height) < 96;
  };

  const sendLabel =
    state.activeTurn === null
      ? "Send"
      : delivery === "interrupt"
        ? "Stop & send"
        : delivery === "steer"
          ? "Steer"
          : "Queue";

  return (
    <Page>
      <Stack.Screen
        options={{
          title: state.summary.title,
          headerRight: () => (
            <Pressable
              accessibilityLabel="Task settings"
              accessibilityRole="button"
              hitSlop={theme.metrics.space.contentGap}
              onPress={() =>
                router.push({
                  pathname: "/task/[threadId]",
                  params: { threadId: String(threadId) },
                })
              }
            >
              <Text
                allowFontScaling
                style={{
                  color: theme.colors.accent,
                  fontSize: theme.metrics.font.detailSize,
                  fontWeight: theme.metrics.font.weightSemibold,
                }}
              >
                Manage
              </Text>
            </Pressable>
          ),
        }}
      />
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
              {watchStatus}
            </DetailText>
          )}
          <Conversation
            onAnswerQuestion={(questionId, answers) =>
              remote.client?.threads.answerQuestion(threadId, questionId, { answers }) ??
              Promise.reject(new Error("Core is disconnected"))
            }
            onCancelQueued={(messageId) =>
              remote.client?.threads.cancelQueued(threadId, messageId).then(() => undefined) ??
              Promise.reject(new Error("Core is disconnected"))
            }
            onImplementPlan={async (planId, markdown) => {
              const client = remote.client;
              if (client === null) throw new Error("Core is disconnected");
              await client.threads.send(threadId, {
                messageId: MessageId.make(`mobile_${Crypto.randomUUID()}`),
                text: `Implement this plan:\n\n${markdown}`,
                delivery: "queue",
                interactionMode: "agent",
              });
              await client.threads.implementPlan(threadId, planId);
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            onLoadAttachment={(attachmentId) =>
              remote.client?.threads.attachmentBytes(threadId, attachmentId) ??
              Promise.reject(new Error("Core is disconnected"))
            }
            onLoadTurnDiff={async (turn) => {
              const client = remote.client;
              if (client === null) throw new Error("Core is disconnected");
              const files = await client.checkpoints.turnDiff(threadId, turn);
              await client.uiState.update({
                diffViewed: {
                  key: `${String(threadId)}:${turn}`,
                  viewedAt: new Date().toISOString(),
                },
              });
              return files;
            }}
            onMoveQueued={(messageId, targetMessageId, insertAfter) =>
              remote.client?.threads
                .reorderQueued(threadId, { messageId, targetMessageId, insertAfter })
                .then(() => undefined) ?? Promise.reject(new Error("Core is disconnected"))
            }
            onRevertTurn={async (turn) => {
              const client = remote.client;
              if (client === null) throw new Error("Core is disconnected");
              await client.checkpoints.revertTurn(threadId, turn);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
            onSendQueuedNow={async (messageId) => {
              const client = remote.client;
              if (client === null) throw new Error("Core is disconnected");
              await client.threads.sendQueuedNow(threadId, messageId);
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }}
            onUpdateQueued={(messageId, text) =>
              remote.client?.threads
                .updateQueued(threadId, messageId, { text })
                .then(() => undefined) ?? Promise.reject(new Error("Core is disconnected"))
            }
            state={state}
          />
        </ScrollView>
        <View
          style={[
            styles.composer,
            {
              backgroundColor: theme.colors.bgBase,
              borderTopColor: theme.colors.borderBase,
              borderTopWidth: theme.metrics.field.borderWidth,
              gap: theme.metrics.space.contentGap,
              paddingHorizontal: theme.metrics.space.screenGutter,
              paddingTop: theme.metrics.space.contentGap,
              paddingBottom: Math.max(theme.metrics.space.contentGap, insets.bottom),
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={{ gap: theme.metrics.space.compactGap }}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
          >
            {interactionModes.map((candidate) => {
              const selected = mode === candidate.value;
              return (
                <Pressable
                  key={candidate.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setMode(candidate.value)}
                  style={({ pressed }) => [
                    styles.choice,
                    {
                      backgroundColor: selected ? theme.colors.accentSubtle : theme.colors.control,
                      borderColor: selected ? theme.colors.accent : theme.colors.borderBase,
                      borderRadius: theme.metrics.radius.control,
                      borderWidth: theme.metrics.field.borderWidth,
                      minHeight: theme.metrics.interaction.touchTarget,
                      opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                      paddingHorizontal: theme.metrics.space.panelPad,
                    },
                  ]}
                >
                  <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                    {candidate.label}
                  </DetailText>
                </Pressable>
              );
            })}
          </ScrollView>
          {state.activeTurn === null ? null : (
            <ScrollView
              contentContainerStyle={{ gap: theme.metrics.space.compactGap }}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
            >
              {deliveryModes.map((candidate) => {
                const disabled = candidate.value === "steer" && !state.capabilities.steer;
                const selected = delivery === candidate.value;
                return (
                  <Pressable
                    key={candidate.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled }}
                    disabled={disabled}
                    onPress={() => setDelivery(candidate.value)}
                    style={({ pressed }) => [
                      styles.choice,
                      {
                        backgroundColor: selected ? theme.colors.accentSubtle : theme.colors.layer01,
                        borderColor: selected ? theme.colors.accent : theme.colors.borderMuted,
                        borderRadius: theme.metrics.radius.control,
                        borderWidth: theme.metrics.field.borderWidth,
                        minHeight: theme.metrics.interaction.touchTarget,
                        opacity: disabled
                          ? theme.metrics.interaction.disabledOpacity
                          : pressed
                            ? theme.metrics.interaction.pressedOpacity
                            : 1,
                        paddingHorizontal: theme.metrics.space.panelPad,
                      },
                    ]}
                  >
                    <DetailText style={{ color: selected ? theme.colors.accent : undefined }}>
                      {candidate.label}
                    </DetailText>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {attachments.length === 0 ? null : (
            <ScrollView
              contentContainerStyle={{ gap: theme.metrics.space.compactGap }}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {attachments.map((attachment) => (
                <View key={attachment.id} style={styles.attachmentPreview}>
                  <Image
                    accessibilityLabel={attachment.upload.name}
                    source={{ uri: attachment.uri }}
                    style={[
                      {
                        borderRadius: theme.metrics.radius.control,
                        height: theme.metrics.field.multilineMinHeight,
                        width: theme.metrics.field.multilineMinHeight,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityLabel={`Remove ${attachment.upload.name}`}
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
                        height: theme.metrics.interaction.touchTarget,
                        width: theme.metrics.interaction.touchTarget,
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
            </ScrollView>
          )}
          <TextField
            autoCapitalize="sentences"
            label="Message"
            minRows={2}
            multiline
            onChangeText={setDraft}
            placeholder={state.activeTurn === null ? "Ask Honk" : "Add the next instruction"}
            submitBehavior="newline"
            value={draft}
          />
          {error === null ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.errFg }}>
              {error}
            </DetailText>
          )}
          <View style={[styles.actions, { gap: theme.metrics.space.contentGap }]}>
            <ActionButton
              disabled={attachments.length >= SEND_MAX_ATTACHMENTS}
              label="Add image"
              onPress={() => void chooseImages()}
              tone="neutral"
            />
            {state.activeTurn === null ? null : (
              <ActionButton label="Stop" onPress={() => void interrupt()} tone="destructive" />
            )}
            <ActionButton
              disabled={draft.trim() === "" && attachments.length === 0}
              label={sendLabel}
              onPress={() => void send()}
              pending={sending}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  composer: {
    width: "100%",
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  choice: {
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentPreview: {
    position: "relative",
  },
  removeAttachment: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    right: -4,
    top: -4,
  },
});
