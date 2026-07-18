import * as React from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import type { OpenCodePromptFileAttachment } from "@honk/opencode";
import { Picker } from "@honk/ui";

import { ActionButton, DetailText, useHonkTheme } from "./ui";

const ATTACHMENT_ANIMATION_MS = 180;

export interface ComposerImage {
  readonly id: string;
  readonly uri: string;
  readonly file: OpenCodePromptFileAttachment;
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
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onRemoveAttachment: (id: string) => void;
  readonly onSend: () => void;
  readonly running: boolean;
  readonly sending: boolean;
}

export const ChatComposer = React.forwardRef<View, ChatComposerProps>(function ChatComposer(
  {
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
    onLayout,
    onRemoveAttachment,
    onSend,
    running,
    sending,
  },
  forwardedRef,
): React.ReactElement {
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
      </Animated.View>

      <View style={[styles.inputRow, { gap: theme.metrics.space.contentGap }]}>
        <ActionButton
          accessibilityLabel="Add image"
          disabled={attachments.length >= maxAttachments}
          label="+"
          onPress={onAttach}
          size="compact"
          tone="neutral"
        />
        <TextInput
          accessibilityLabel="Message"
          allowFontScaling
          autoCapitalize="sentences"
          keyboardAppearance={theme.mode}
          multiline
          onChangeText={onChangeDraft}
          onSubmitEditing={onSend}
          placeholder={running ? "Add the next instruction" : "Ask Honk"}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="send"
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
        <ActionButton
          disabled={!canSend}
          label={running ? "Queue" : "Send"}
          onPress={onSend}
          pending={sending}
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
      ref={forwardedRef}
      onLayout={onLayout}
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
});

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
