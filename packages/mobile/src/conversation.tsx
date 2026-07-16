import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type {
  Message,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  Part,
} from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { MarkdownText } from "./markdown";
import { ActionButton, BodyText, DetailText, useHonkTheme } from "./ui";

type AssistantMessage = Extract<Message, { role: "assistant" }>;
type ToolContent = Extract<Part, { type: "tool" }>;

interface ConversationProps {
  readonly messages: readonly Message[];
  readonly parts: readonly Part[];
  readonly questions: readonly OpenCodeQuestionRequest[];
  readonly permissions: readonly OpenCodePermissionRequest[];
  readonly onAnswerQuestion: (
    requestId: string,
    answers: readonly (readonly string[])[],
  ) => Promise<void>;
  readonly onRejectQuestion: (requestId: string) => Promise<void>;
  readonly onAnswerPermission: (
    requestId: string,
    reply: "once" | "always" | "reject",
  ) => Promise<void>;
}

function ExpandableText({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}): React.ReactElement | null {
  const theme = useHonkTheme();
  const [expanded, setExpanded] = React.useState(false);
  if (text.trim() === "") return null;
  return (
    <View style={{ gap: theme.metrics.space.compactGap }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
      >
        <DetailText>
          {expanded ? `Hide ${label.toLocaleLowerCase()}` : `Show ${label.toLocaleLowerCase()}`}
        </DetailText>
      </Pressable>
      {expanded ? <DetailText selectable>{text}</DetailText> : null}
    </View>
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

function AssistantContentView({ content }: { readonly content: Part }): React.ReactElement | null {
  switch (content.type) {
    case "text":
      return content.text.trim() === "" ? null : <MarkdownText markdown={content.text} />;
    case "reasoning":
      return <ExpandableText label="Reasoning" text={content.text} />;
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
  parts,
}: {
  readonly message: AssistantMessage;
  readonly parts: readonly Part[];
}): React.ReactElement {
  const theme = useHonkTheme();
  const error = assistantError(message);
  return (
    <View style={{ gap: theme.metrics.space.contentGap }}>
      {parts.map((content) => (
        <AssistantContentView key={content.id} content={content} />
      ))}
      {message.time.completed === undefined && parts.length === 0 ? (
        <DetailText>Thinking…</DetailText>
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
          <BodyText style={{ color: theme.colors.errFg }}>{error}</BodyText>
        </View>
      )}
    </View>
  );
}

function MessageView({
  message,
  parts,
}: {
  readonly message: Message;
  readonly parts: readonly Part[];
}): React.ReactElement | null {
  const theme = useHonkTheme();

  switch (message.role) {
    case "user":
      return (
        <View
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
        </View>
      );
    case "assistant":
      return <AssistantMessageView message={message} parts={parts} />;
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

export function Conversation({
  messages,
  onAnswerPermission,
  onAnswerQuestion,
  onRejectQuestion,
  permissions,
  parts,
  questions,
}: ConversationProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View style={{ gap: theme.metrics.space.rowGap }}>
      {messages.map((message) => (
        <MessageView
          key={message.id}
          message={message}
          parts={parts.filter((part) => part.messageID === message.id)}
        />
      ))}
      {questions.map((request) => (
        <QuestionCard
          key={request.id}
          onAnswer={(answers) => onAnswerQuestion(request.id, answers)}
          onReject={() => onRejectQuestion(request.id)}
          request={request}
        />
      ))}
      {permissions.map((request) => (
        <PermissionCard
          key={request.id}
          onAnswer={(reply) => onAnswerPermission(request.id, reply)}
          request={request}
        />
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
  card: {
    width: "100%",
  },
  image: {
    aspectRatio: 4 / 3,
    width: "100%",
  },
  toolHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  userMessage: {
    width: "100%",
  },
});
