import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type {
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  ThreadState,
} from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";

import { MarkdownText } from "./markdown";
import { ActionButton, BodyText, DetailText, useHonkTheme } from "./ui";

interface ConversationProps {
  readonly state: ThreadState;
  readonly questions: readonly QuestionRequest[];
  readonly permissions: readonly PermissionRequest[];
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

const partsForMessage = (parts: readonly Part[], messageId: string): readonly Part[] =>
  parts.filter((part) => part.messageID === messageId);

const errorText = (message: Message): string | null => {
  if (message.role !== "assistant" || message.error === undefined) return null;
  const data = Reflect.get(message.error, "data");
  if (typeof data === "object" && data !== null) {
    const detail = Reflect.get(data, "message");
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return message.error.name;
};

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

function FilePartView({
  part,
}: {
  readonly part: Extract<Part, { type: "file" }>;
}): React.ReactElement {
  const theme = useHonkTheme();
  const isImage = part.mime.startsWith("image/");
  const canRender = isImage && /^(data:|https?:)/.test(part.url);
  const sourceLabel =
    part.source === undefined
      ? null
      : part.source.type === "resource"
        ? part.source.uri
        : part.source.path;
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
          accessibilityLabel={part.filename ?? "Attached image"}
          contentFit="contain"
          source={{ uri: part.url }}
          style={[
            styles.image,
            { backgroundColor: theme.colors.bgBase, borderRadius: theme.metrics.radius.control },
          ]}
        />
      ) : null}
      <BodyText numberOfLines={2}>{part.filename ?? sourceLabel ?? "Attachment"}</BodyText>
      <DetailText>{part.mime}</DetailText>
    </View>
  );
}

function ToolPartView({
  part,
}: {
  readonly part: Extract<Part, { type: "tool" }>;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [expanded, setExpanded] = React.useState(false);
  const state = part.state;
  const title =
    state.status === "running" || state.status === "completed"
      ? (state.title ?? part.tool)
      : part.tool;
  const detail =
    state.status === "completed"
      ? state.output
      : state.status === "error"
        ? state.error
        : JSON.stringify(state.input, null, 2);
  const tone =
    state.status === "error"
      ? theme.colors.errFg
      : state.status === "completed"
        ? theme.colors.okFg
        : theme.colors.accent;
  const tool = part.tool.toLocaleLowerCase();
  const verb =
    tool.includes("read") || tool.includes("grep") || tool.includes("glob") || tool.includes("list")
      ? state.status === "running"
        ? "Exploring…"
        : "Explored"
      : tool.includes("edit") || tool.includes("write") || tool.includes("patch")
        ? state.status === "running"
          ? "Editing…"
          : "Edited"
        : tool.includes("bash") || tool.includes("shell") || tool.includes("command")
          ? state.status === "running"
            ? "Running…"
            : "Ran"
          : state.status === "running"
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
        accessibilityLabel={`${title}, ${state.status}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolHeader}
      >
        <DetailText numberOfLines={1} style={{ flex: 1 }}>
          <DetailText style={{ fontWeight: theme.metrics.font.weightMedium }}>{verb}</DetailText>
          {title === part.tool ? "" : ` · ${title}`}
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

function AssistantPart({ part }: { readonly part: Part }): React.ReactElement | null {
  const theme = useHonkTheme();
  switch (part.type) {
    case "text":
      return part.text.trim() === "" ? null : <MarkdownText markdown={part.text} />;
    case "reasoning":
      return <ExpandableText label="Reasoning" text={part.text} />;
    case "file":
      return <FilePartView part={part} />;
    case "tool":
      return <ToolPartView part={part} />;
    case "subtask":
      return (
        <View style={{ gap: theme.metrics.space.compactGap }}>
          <DetailText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            Subtask · {part.agent}
          </DetailText>
          <BodyText selectable>{part.description}</BodyText>
        </View>
      );
    case "patch":
      return (
        <View style={{ paddingHorizontal: theme.metrics.space.contentGap }}>
          <DetailText>
            <DetailText style={{ fontWeight: theme.metrics.font.weightMedium }}>Changed</DetailText>
            {` · ${part.files.length} ${part.files.length === 1 ? "file" : "files"}`}
          </DetailText>
        </View>
      );
    case "retry":
      return (
        <DetailText style={{ color: theme.colors.warnFg }}>
          Retrying after {part.error.data.message}
        </DetailText>
      );
    case "compaction":
      return <DetailText>Conversation context compacted.</DetailText>;
    case "agent":
      return <DetailText>Agent: {part.name}</DetailText>;
    case "step-start":
      return <DetailText>Working…</DetailText>;
    case "step-finish":
      return part.reason === "stop" ? null : <DetailText>Finished: {part.reason}</DetailText>;
    case "snapshot":
      return null;
  }
}

function MessageView({
  message,
  parts,
}: {
  readonly message: Message;
  readonly parts: readonly Part[];
}): React.ReactElement {
  const theme = useHonkTheme();
  const error = errorText(message);

  if (message.role === "user") {
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
        {parts.map((part) =>
          part.type === "text" ? (
            part.text.trim() === "" ? null : (
              <BodyText key={part.id} selectable>
                {part.text}
              </BodyText>
            )
          ) : part.type === "file" ? (
            <FilePartView key={part.id} part={part} />
          ) : null,
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.metrics.space.contentGap }}>
      {parts.map((part) => (
        <AssistantPart key={part.id} part={part} />
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

function QuestionCard({
  onAnswer,
  onReject,
  request,
}: {
  readonly onAnswer: (answers: readonly (readonly string[])[]) => Promise<void>;
  readonly onReject: () => Promise<void>;
  readonly request: QuestionRequest;
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
  readonly request: PermissionRequest;
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
        {request.permission}
      </BodyText>
      {request.patterns.map((pattern) => (
        <DetailText key={pattern} selectable>
          {pattern}
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
  onAnswerPermission,
  onAnswerQuestion,
  onRejectQuestion,
  permissions,
  questions,
  state,
}: ConversationProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View style={{ gap: theme.metrics.space.rowGap }}>
      {state.messages.map((message) => (
        <MessageView
          key={message.id}
          message={message}
          parts={partsForMessage(state.parts, message.id)}
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
