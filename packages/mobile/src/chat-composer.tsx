import * as React from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import type { OpenCodePromptFileAttachment } from "@honk/opencode";
import { Icon, IconButton, Picker } from "@honk/ui";

import { QueueTray } from "./composer/queue-tray";
import type { QueueItem } from "./composer/queue-store";
import { ActionButton, DetailText, useHonkTheme } from "./ui";

const ATTACHMENT_ANIMATION_MS = 180;

export interface ComposerImage {
  readonly id: string;
  readonly uri: string;
  readonly file: OpenCodePromptFileAttachment;
}

export interface ComposerSelection {
  readonly start: number;
  readonly end: number;
}

interface ChatComposerProps {
  readonly agent: string | null;
  readonly agents: readonly string[];
  readonly attachments: readonly ComposerImage[];
  readonly bottomInset: number;
  readonly draft: string;
  readonly error: string | null;
  readonly maxAttachments: number;
  readonly onAgentChange: (agent: string) => void;
  readonly onAttach: () => void;
  readonly onChangeDraft: (draft: string) => void;
  readonly onRemoveAttachment: (id: string) => void;
  readonly onRemoveQueued: (id: string) => void;
  readonly onSelectionChange: (selection: ComposerSelection) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly queued: readonly QueueItem[];
  readonly running: boolean;
  // Set only to move the caret after accepting a suggestion. Left null while typing so the input
  // keeps its own caret and never fights the keyboard.
  readonly selection: ComposerSelection | null;
}

export function ChatComposer({
  agent,
  agents,
  attachments,
  bottomInset,
  draft,
  error,
  maxAttachments,
  onAgentChange,
  onAttach,
  onChangeDraft,
  onRemoveAttachment,
  onRemoveQueued,
  onSelectionChange,
  onSend,
  onStop,
  queued,
  running,
  selection,
}: ChatComposerProps): React.ReactElement {
  const theme = useHonkTheme();
  const [displayedAttachments, setDisplayedAttachments] =
    React.useState<readonly ComposerImage[]>(attachments);
  const [attachmentHeight, setAttachmentHeight] = React.useState(0);
  const hasAttachments = attachments.length > 0;

  React.useEffect(() => {
    if (hasAttachments) {
      setDisplayedAttachments(attachments);
      return;
    }
    const timeout = setTimeout(() => setDisplayedAttachments([]), ATTACHMENT_ANIMATION_MS);
    return () => clearTimeout(timeout);
  }, [attachments, hasAttachments]);

  const attachmentStyle = useAnimatedStyle(() => ({
    height: withTiming(hasAttachments ? attachmentHeight : 0, {
      duration: ATTACHMENT_ANIMATION_MS,
      easing: Easing.inOut(Easing.ease),
    }),
    opacity: withTiming(hasAttachments ? 1 : 0, {
      duration: ATTACHMENT_ANIMATION_MS,
      easing: Easing.inOut(Easing.ease),
    }),
  }));
  const canSend = draft.trim() !== "" || attachments.length > 0;
  const surfaceStyle = [
    styles.surface,
    {
      backgroundColor: theme.colors.layer01,
      borderColor: theme.colors.borderStrong,
      borderRadius: theme.metrics.radius.panel,
      borderWidth: theme.metrics.field.borderWidth,
      gap: theme.metrics.space.contentGap,
      padding: theme.metrics.space.contentGap,
    },
  ];
  const content = (
    <>
      <QueueTray items={queued} onRemove={onRemoveQueued} running={running} />

      {agents.length === 0 || agent === null ? null : (
        <Picker.Root value={agent} onValueChange={onAgentChange}>
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

      <Animated.View style={[styles.attachmentClip, attachmentStyle]}>
        <View
          onLayout={(event) => setAttachmentHeight(Math.ceil(event.nativeEvent.layout.height))}
          style={[styles.attachmentRail, { gap: theme.metrics.space.compactGap }]}
        >
          {displayedAttachments.map((attachment) => (
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
                hitSlop={8}
                onPress={() => onRemoveAttachment(attachment.id)}
                style={({ pressed }) => [
                  styles.removeAttachment,
                  {
                    backgroundColor: theme.colors.errBg,
                    borderRadius: theme.metrics.radius.pill,
                    opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                  },
                ]}
              >
                <Icon color={theme.colors.errFg} name="xmark-circle" size="md" />
              </Pressable>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={[styles.inputRow, { gap: theme.metrics.space.contentGap }]}>
        <IconButton
          accessibilityLabel="Add image"
          disabled={attachments.length >= maxAttachments}
          onClick={onAttach}
          size="sm"
          variant="neutral"
        >
          <Icon name="photo" size="md" />
        </IconButton>
        <TextInput
          accessibilityLabel="Message"
          allowFontScaling
          autoCapitalize="sentences"
          keyboardAppearance={theme.mode}
          multiline
          onChangeText={onChangeDraft}
          onSelectionChange={(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
            onSelectionChange(event.nativeEvent.selection)
          }
          onSubmitEditing={onSend}
          placeholder={running ? "Add the next instruction" : "Ask Honk"}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="send"
          {...(selection === null ? {} : { selection })}
          selectionColor={theme.colors.accent}
          style={[
            styles.input,
            {
              color: theme.colors.textPrimary,
              fontSize: theme.metrics.font.bodySize,
              lineHeight: theme.metrics.font.bodyLeading,
              maxHeight: theme.metrics.font.bodyLeading * 6,
              minHeight: theme.metrics.interaction.touchTarget,
            },
          ]}
          submitBehavior="submit"
          value={draft}
        />
        {/*
          Stop sits beside the enqueue action rather than replacing it: they act on different
          things, and a Stop that took the send button's place would make it impossible to line up
          the next instruction while the agent works.
        */}
        {running ? (
          <ActionButton label="Stop" onPress={onStop} size="compact" tone="destructive" />
        ) : null}
        <ActionButton
          disabled={!canSend}
          label={running ? "Queue" : "Send"}
          onPress={onSend}
          size="compact"
        />
      </View>
      {error === null ? null : (
        <DetailText
          accessibilityLiveRegion="polite"
          selectable
          style={{ color: theme.colors.errFg }}
        >
          {error}
        </DetailText>
      )}
    </>
  );

  return (
    <View
      style={{
        paddingBottom: Math.max(theme.metrics.space.contentGap, bottomInset),
        paddingHorizontal: theme.metrics.space.screenGutter,
        paddingTop: theme.metrics.space.contentGap,
      }}
    >
      {isLiquidGlassAvailable() ? (
        <GlassView
          colorScheme={theme.mode}
          glassEffectStyle="regular"
          isInteractive
          style={[surfaceStyle, { backgroundColor: "transparent" }]}
          tintColor={theme.colors.layer01}
        >
          {content}
        </GlassView>
      ) : (
        <View style={surfaceStyle}>{content}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  attachmentClip: {
    overflow: "hidden",
  },
  attachmentPreview: {
    position: "relative",
  },
  attachmentRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: 8,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  inputRow: {
    alignItems: "flex-end",
    flexDirection: "row",
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
  surface: {
    borderCurve: "continuous",
    overflow: "hidden",
    width: "100%",
  },
});
