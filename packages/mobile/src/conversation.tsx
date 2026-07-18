import * as React from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import Animated, {
  Easing,
  FadeIn,
  SlideInDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type {
  Message,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  Part,
} from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { type ConversationItem, buildConversationItems } from "./conversation-items";
import { MarkdownText } from "./markdown";
import { ActionButton, BodyText, DetailText, useHonkTheme } from "./ui";

type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolContent = Extract<Part, { type: "tool" }>;

interface ConversationActions {
  readonly onAnswerQuestion: (
    requestId: string,
    answers: readonly (readonly string[])[],
  ) => Promise<void>;
  readonly onRejectQuestion: (requestId: string) => Promise<void>;
  readonly onAnswerPermission: (
    requestId: string,
    reply: "once" | "always" | "reject",
  ) => Promise<void>;
  readonly onOpenReasoning: (reasoning: string) => void;
}

interface ConversationProps extends ConversationActions {
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly questions: readonly OpenCodeQuestionRequest[];
  readonly permissions: readonly OpenCodePermissionRequest[];
}

function ReasoningRow({
  onOpen,
  text,
}: {
  readonly onOpen: () => void;
  readonly text: string;
}): React.ReactElement | null {
  const theme = useHonkTheme();
  const label = text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0);
  if (text.trim() === "") return null;
  return (
    <Pressable
      accessibilityHint="Opens the full reasoning summary"
      accessibilityLabel={label ?? "Reasoning"}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.reasoningRow,
        {
          gap: theme.metrics.space.compactGap,
          opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
          paddingVertical: theme.metrics.space.compactGap,
        },
      ]}
    >
      <DetailText numberOfLines={1} style={styles.reasoningLabel}>
        {label ?? "Reasoning"}
      </DetailText>
      <DetailText>›</DetailText>
    </Pressable>
  );
}

function AttachmentCard({
  name,
  uri,
}: {
  readonly name: string | undefined;
  readonly uri: string;
}): React.ReactElement {
  const theme = useHonkTheme();
  const canRender = /^(data:image\/|https?:)/.test(uri);
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.layer01,
          borderColor: theme.colors.borderMuted,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          gap: theme.metrics.space.compactGap,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      {canRender ? (
        <Image
          accessibilityLabel={name ?? "Attached image"}
          contentFit="contain"
          source={{ uri }}
          style={[
            styles.image,
            { backgroundColor: theme.colors.bgBase, borderRadius: theme.metrics.radius.control },
          ]}
        />
      ) : null}
      <BodyText numberOfLines={2}>{name ?? "Attachment"}</BodyText>
    </View>
  );
}

function toolDetail(state: ToolContent["state"]): string {
  if (state.status === "completed") return state.output;
  if (state.status === "error") return state.error;
  if (state.status === "pending") return state.raw;
  return JSON.stringify(state.input, null, 2);
}

function ToolContentView({ content }: { readonly content: ToolContent }): React.ReactElement {
  const theme = useHonkTheme();
  const [expanded, setExpanded] = React.useState(false);
  const state = content.state;
  const detail = toolDetail(state);
  const tone =
    state.status === "error"
      ? theme.colors.errFg
      : state.status === "completed"
        ? theme.colors.okFg
        : theme.colors.accent;
  const tool = content.tool.toLocaleLowerCase();
  const active = state.status === "pending" || state.status === "running";
  const verb =
    tool.includes("read") || tool.includes("grep") || tool.includes("glob") || tool.includes("list")
      ? active
        ? "Exploring…"
        : "Explored"
      : tool.includes("edit") || tool.includes("write") || tool.includes("patch")
        ? active
          ? "Editing…"
          : "Edited"
        : tool.includes("bash") || tool.includes("shell") || tool.includes("command")
          ? active
            ? "Running…"
            : "Ran"
          : active
            ? "Working…"
            : "Worked";

  return (
    <View
      style={{
        gap: theme.metrics.space.compactGap,
        paddingHorizontal: theme.metrics.space.contentGap,
      }}
    >
      <Pressable
        accessibilityLabel={`${content.tool}, ${state.status}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolHeader}
      >
        <DetailText numberOfLines={1} style={{ flex: 1 }}>
          <DetailText style={{ fontWeight: theme.metrics.font.weightMedium }}>{verb}</DetailText>
          {` · ${content.tool}`}
        </DetailText>
        {state.status === "error" || state.status === "running" ? (
          <DetailText style={{ color: tone }}>{state.status}</DetailText>
        ) : null}
      </Pressable>
      {expanded && detail.trim() !== "" ? (
        <ScrollView horizontal>
          <Text
            selectable
            style={{
              color: state.status === "error" ? theme.colors.errFg : theme.colors.textMuted,
              fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
              fontSize: theme.metrics.font.captionSize,
              lineHeight: theme.metrics.font.captionLeading,
            }}
          >
            {detail}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function ThinkingIndicator(): React.ReactElement {
  const theme = useHonkTheme();
  const opacity = useSharedValue(0.35);
  React.useEffect(() => {
    opacity.set(withRepeat(withTiming(1, { duration: 900 }), -1, true));
    return () => cancelAnimation(opacity);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.Text
      accessibilityLiveRegion="polite"
      entering={FadeIn.delay(350).duration(250)}
      style={[
        animatedStyle,
        {
          color: theme.colors.textMuted,
          fontSize: theme.metrics.font.detailSize,
          lineHeight: theme.metrics.font.detailLeading,
        },
      ]}
    >
      Thinking…
    </Animated.Text>
  );
}

function AssistantActions({ text }: { readonly text: string }): React.ReactElement {
  const theme = useHonkTheme();
  const [copied, setCopied] = React.useState(false);
  return (
    <View style={[styles.assistantActions, { gap: theme.metrics.space.compactGap }]}>
      <ActionButton
        label={copied ? "Copied" : "Copy"}
        onPress={() => {
          void Clipboard.setStringAsync(text).then(() => {
            setCopied(true);
            if (process.env.EXPO_OS === "ios") void Haptics.selectionAsync();
            setTimeout(() => setCopied(false), 1_200);
          });
        }}
        size="compact"
        tone="neutral"
      />
      <ActionButton
        label="Share"
        onPress={() => void Share.share({ message: text })}
        size="compact"
        tone="neutral"
      />
    </View>
  );
}

function AssistantContentView({
  content,
  onOpenReasoning,
}: {
  readonly content: Part;
  readonly onOpenReasoning: (reasoning: string) => void;
}): React.ReactElement | null {
  switch (content.type) {
    case "text":
      return content.text.trim() === "" ? null : <MarkdownText markdown={content.text} />;
    case "reasoning":
      return <ReasoningRow onOpen={() => onOpenReasoning(content.text)} text={content.text} />;
    case "tool":
      return <ToolContentView content={content} />;
    case "compaction":
      return <DetailText>Conversation context compacted.</DetailText>;
    default:
      return null;
  }
}

function assistantError(message: AssistantMessage): string | null {
  if (message.error === undefined) return null;
  const detail = Reflect.get(message.error.data, "message");
  return typeof detail === "string" ? detail : message.error.name;
}

function AssistantMessageView({
  message,
  onOpenReasoning,
  parts,
}: {
  readonly message: AssistantMessage;
  readonly onOpenReasoning: (reasoning: string) => void;
  readonly parts: readonly Part[];
}): React.ReactElement {
  const theme = useHonkTheme();
  const error = assistantError(message);
  const text = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return (
    <View style={{ gap: theme.metrics.space.contentGap }}>
      {parts.map((content) => (
        <AssistantContentView
          key={content.id}
          content={content}
          onOpenReasoning={onOpenReasoning}
        />
      ))}
      {message.time.completed === undefined && parts.length === 0 ? <ThinkingIndicator /> : null}
      {message.time.completed !== undefined && text !== "" ? (
        <AssistantActions text={text} />
      ) : null}
      {error === null ? null : (
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.errBg,
              borderColor: theme.colors.errBorder,
              borderRadius: theme.metrics.radius.panel,
              borderWidth: theme.metrics.field.borderWidth,
              padding: theme.metrics.space.panelPad,
            },
          ]}
        >
          <BodyText selectable style={{ color: theme.colors.errFg }}>
            {error}
          </BodyText>
        </View>
      )}
    </View>
  );
}

function MessageView({
  animate,
  message,
  onOpenReasoning,
  parts,
}: {
  readonly animate: boolean;
  readonly message: Message;
  readonly onOpenReasoning: (reasoning: string) => void;
  readonly parts: readonly Part[];
}): React.ReactElement | null {
  const theme = useHonkTheme();

  switch (message.role) {
    case "user":
      return (
        <Animated.View
          {...(animate
            ? { entering: SlideInDown.easing(Easing.out(Easing.exp)).duration(700) }
            : {})}
          style={[
            styles.userMessage,
            {
              backgroundColor: theme.colors.messageBubbleBg,
              borderColor: theme.colors.messageBubbleRing,
              borderRadius: theme.metrics.radius.bubble,
              borderWidth: theme.metrics.field.borderWidth,
              gap: theme.metrics.space.contentGap,
              paddingHorizontal: theme.metrics.space.rowGap,
              paddingVertical: theme.metrics.space.contentGap,
            },
          ]}
        >
          {parts.map((part) => {
            if (part.type === "text") {
              return part.text.trim() === "" ? null : (
                <BodyText key={part.id} selectable>
                  {part.text}
                </BodyText>
              );
            }
            if (part.type === "file") {
              return <AttachmentCard key={part.id} name={part.filename} uri={part.url} />;
            }
            return null;
          })}
        </Animated.View>
      );
    case "assistant":
      return (
        <AssistantMessageView message={message} onOpenReasoning={onOpenReasoning} parts={parts} />
      );
  }
}

function QuestionCard({
  onAnswer,
  onReject,
  request,
}: {
  readonly onAnswer: (answers: readonly (readonly string[])[]) => Promise<void>;
  readonly onReject: () => Promise<void>;
  readonly request: OpenCodeQuestionRequest;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [answers, setAnswers] = React.useState<readonly (readonly string[])[]>(() =>
    request.questions.map(() => []),
  );
  const [custom, setCustom] = React.useState<readonly string[]>(() =>
    request.questions.map(() => ""),
  );
  const [pending, setPending] = React.useState<"answer" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (questionIndex: number, label: string, multiple: boolean): void => {
    setAnswers((current) =>
      current.map((answer, index) => {
        if (index !== questionIndex) return answer;
        if (!multiple) return [label];
        return answer.includes(label)
          ? answer.filter((candidate) => candidate !== label)
          : [...answer, label];
      }),
    );
  };

  const submit = async (): Promise<void> => {
    const resolved = answers.map((answer, index) => {
      const value = custom[index]?.trim() ?? "";
      return value.length > 0 ? [value] : answer;
    });
    if (resolved.some((answer) => answer.length === 0)) {
      setError("Answer every question before sending.");
      return;
    }
    setPending("answer");
    setError(null);
    try {
      await onAnswer(resolved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The answer could not be sent.");
    } finally {
      setPending(null);
    }
  };

  const reject = async (): Promise<void> => {
    setPending("reject");
    setError(null);
    try {
      await onReject();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The question could not be dismissed.");
    } finally {
      setPending(null);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.infoBg,
          borderColor: theme.colors.infoBorder,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          gap: theme.metrics.space.rowGap,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      {request.questions.map((question, questionIndex) => (
        <View
          key={`${request.id}:${questionIndex}`}
          style={{ gap: theme.metrics.space.contentGap }}
        >
          <DetailText style={{ color: theme.colors.infoFg }}>{question.header}</DetailText>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            {question.question}
          </BodyText>
          {question.options.map((option) => {
            const checked = answers[questionIndex]?.includes(option.label) ?? false;
            return (
              <Pressable
                key={option.label}
                accessibilityRole={question.multiple === true ? "checkbox" : "radio"}
                accessibilityState={{ checked }}
                onPress={() => toggle(questionIndex, option.label, question.multiple === true)}
                style={({ pressed }) => ({
                  backgroundColor: checked ? theme.colors.accentSubtle : theme.colors.layer01,
                  borderColor: checked ? theme.colors.accent : theme.colors.borderBase,
                  borderRadius: theme.metrics.radius.control,
                  borderWidth: theme.metrics.field.borderWidth,
                  gap: theme.metrics.space.compactGap,
                  minHeight: theme.metrics.interaction.touchTarget,
                  opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                  padding: theme.metrics.space.panelPad,
                })}
              >
                <BodyText>{option.label}</BodyText>
                <DetailText>{option.description}</DetailText>
              </Pressable>
            );
          })}
          {question.custom === true ? (
            <TextField
              autoCapitalize="sentences"
              label="Other response"
              onChangeText={(value) =>
                setCustom((current) =>
                  current.map((entry, index) => (index === questionIndex ? value : entry)),
                )
              }
              placeholder="Type a custom answer"
              value={custom[questionIndex] ?? ""}
            />
          ) : null}
        </View>
      ))}
      {error === null ? null : (
        <DetailText style={{ color: theme.colors.errFg }}>{error}</DetailText>
      )}
      <View style={[styles.actions, { gap: theme.metrics.space.contentGap }]}>
        <ActionButton
          label="Dismiss"
          onPress={() => void reject()}
          pending={pending === "reject"}
          tone="neutral"
        />
        <ActionButton
          label="Send answer"
          onPress={() => void submit()}
          pending={pending === "answer"}
        />
      </View>
    </View>
  );
}

function PermissionCard({
  onAnswer,
  request,
}: {
  readonly onAnswer: (reply: "once" | "always" | "reject") => Promise<void>;
  readonly request: OpenCodePermissionRequest;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [pending, setPending] = React.useState<"once" | "always" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const answer = async (reply: "once" | "always" | "reject"): Promise<void> => {
    setPending(reply);
    setError(null);
    try {
      await onAnswer(reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The permission response failed.");
    } finally {
      setPending(null);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.warnBg,
          borderColor: theme.colors.warnBorder,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          gap: theme.metrics.space.contentGap,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      <DetailText style={{ color: theme.colors.warnFg }}>Permission requested</DetailText>
      <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
        {request.action}
      </BodyText>
      {request.resources.map((resource) => (
        <DetailText key={resource} selectable>
          {resource}
        </DetailText>
      ))}
      {error === null ? null : (
        <DetailText style={{ color: theme.colors.errFg }}>{error}</DetailText>
      )}
      <View style={[styles.actions, { gap: theme.metrics.space.contentGap }]}>
        <ActionButton
          label="Reject"
          onPress={() => void answer("reject")}
          pending={pending === "reject"}
          tone="destructive"
        />
        <ActionButton
          label="Allow once"
          onPress={() => void answer("once")}
          pending={pending === "once"}
          tone="neutral"
        />
        <ActionButton
          label="Always allow"
          onPress={() => void answer("always")}
          pending={pending === "always"}
        />
      </View>
    </View>
  );
}

export function ConversationRow({
  actions,
  animateMessageID,
  item,
}: {
  readonly actions: ConversationActions;
  readonly animateMessageID: string | null;
  readonly item: ConversationItem;
}): React.ReactElement | null {
  switch (item.type) {
    case "message":
      return (
        <MessageView
          key={item.id}
          animate={item.id === animateMessageID}
          message={item.message}
          onOpenReasoning={actions.onOpenReasoning}
          parts={item.parts}
        />
      );
    case "question":
      return (
        <QuestionCard
          key={item.id}
          onAnswer={(answers) => actions.onAnswerQuestion(item.request.id, answers)}
          onReject={() => actions.onRejectQuestion(item.request.id)}
          request={item.request}
        />
      );
    case "permission":
      return (
        <PermissionCard
          key={item.id}
          onAnswer={(reply) => actions.onAnswerPermission(item.request.id, reply)}
          request={item.request}
        />
      );
  }
}

export function Conversation({
  messages,
  onAnswerPermission,
  onAnswerQuestion,
  onOpenReasoning,
  onRejectQuestion,
  permissions,
  parts,
  questions,
}: ConversationProps): React.ReactElement {
  const theme = useHonkTheme();
  const actions = { onAnswerPermission, onAnswerQuestion, onOpenReasoning, onRejectQuestion };
  return (
    <View style={{ gap: theme.metrics.space.rowGap }}>
      {buildConversationItems({ messages, parts, permissions, questions }).map((item) => (
        <ConversationRow key={item.id} actions={actions} animateMessageID={null} item={item} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  assistantActions: {
    flexDirection: "row",
  },
  card: {
    width: "100%",
  },
  image: {
    aspectRatio: 4 / 3,
    width: "100%",
  },
  reasoningLabel: {
    flex: 1,
  },
  reasoningRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  toolHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  userMessage: {
    width: "100%",
  },
});
