import * as React from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Redirect, Stack, router, useLocalSearchParams } from "expo-router";
import { ThreadId } from "@honk/api/core/v1";
import type { ThreadDetail } from "@honk/api/core/v1";
import { TextField } from "@honk/ui/text-field";

import { useRemote } from "../../src/remote-context";
import { ActionButton, BodyText, DetailText, LoadingState, Page, useHonkTheme } from "../../src/ui";

export default function TaskSettingsRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const params = useLocalSearchParams<{ threadId: string }>();
  const threadId = ThreadId.make(params.threadId);
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null);
  const [title, setTitle] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    if (remote.client === null) return;
    void remote.client.threads
      .get(threadId)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setTitle(next.summary.title);
      })
      .catch((cause: unknown) => {
        if (active) setMessage(cause instanceof Error ? cause.message : "The task could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [remote.client, threadId]);

  if (remote.client === null) return <Redirect href="/connect" />;
  if (detail === null && message === null) return <LoadingState label="Loading task settings…" />;

  const save = async (): Promise<void> => {
    const normalized = title.trim();
    if (normalized === "") {
      setMessage("A task title cannot be empty.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const summary = await remote.client?.threads.update(threadId, { title: normalized });
      if (summary === undefined) throw new Error("Core disconnected while renaming the task.");
      setDetail((current) => (current === null ? current : { ...current, summary }));
      await remote.refreshWorkspace();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage("Task renamed.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The task could not be renamed.");
    } finally {
      setPending(false);
    }
  };

  const copyId = async (): Promise<void> => {
    await Clipboard.setStringAsync(String(threadId));
    await Haptics.selectionAsync();
    setMessage("Task ID copied.");
  };

  const archive = (): void => {
    Alert.alert("Archive this task?", "You can restore it from Archived tasks.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: () => {
          void remote.client?.threads
            .archive(threadId)
            .then(async () => {
              await remote.refreshWorkspace();
              router.replace("/(tabs)/home");
            })
            .catch((cause: unknown) =>
              setMessage(cause instanceof Error ? cause.message : "The task could not be archived."),
            );
        },
      },
    ]);
  };

  const remove = (): void => {
    Alert.alert(
      "Delete this task?",
      "This permanently removes the conversation, attachments, and checkpoints from Core.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void remote.client?.threads
              .remove(threadId)
              .then(async () => {
                await remote.refreshWorkspace();
                router.replace("/(tabs)/home");
              })
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : "The task could not be deleted."),
              );
          },
        },
      ],
    );
  };

  return (
    <Page>
      <Stack.Screen options={{ title: "Task settings" }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { gap: theme.metrics.space.sectionGap, padding: theme.metrics.space.screenGutter },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.metrics.space.rowGap }}>
          <TextField
            autoCapitalize="sentences"
            label="Title"
            onChangeText={setTitle}
            returnKeyType="done"
            value={title}
          />
          <View style={styles.trailingAction}>
            <ActionButton label="Save title" onPress={() => void save()} pending={pending} />
          </View>
        </View>

        {detail === null ? null : (
          <View style={{ gap: theme.metrics.space.compactGap }}>
            <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Details</BodyText>
            <DetailText selectable>{detail.cwd}</DetailText>
            <DetailText>
              {String(detail.summary.model)} · {detail.summary.thinkingLevel}
            </DetailText>
            <DetailText>Status: {detail.summary.rowStatus.replace("_", " ")}</DetailText>
            <DetailText selectable>{String(detail.summary.id)}</DetailText>
            <View style={styles.leadingAction}>
              <ActionButton label="Copy task ID" onPress={() => void copyId()} tone="neutral" />
            </View>
            {detail.summary.readableAt === null ? null : (
              <View style={styles.leadingAction}>
                <ActionButton
                  label="Mark as unread"
                  onPress={() => {
                    void remote.client?.uiState
                      .update({ threadRead: { threadId, readAt: null } })
                      .then(() => setMessage("Task marked unread."));
                  }}
                  tone="neutral"
                />
              </View>
            )}
          </View>
        )}

        {message === null ? null : (
          <DetailText accessibilityLiveRegion="polite">{message}</DetailText>
        )}

        <View style={{ gap: theme.metrics.space.rowGap }}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Task lifecycle</BodyText>
          <ActionButton label="Archive task" onPress={archive} tone="neutral" />
          <ActionButton label="Delete task" onPress={remove} tone="destructive" />
        </View>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
  },
  leadingAction: {
    alignItems: "flex-start",
  },
  trailingAction: {
    alignItems: "flex-end",
  },
});
