import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { File, Paths } from "expo-file-system";
import type {
  AttachmentId,
  AttachmentRef,
  FileDiff,
  Message,
  MessageId,
  Part,
  PlanId,
  QuestionId,
  QueuedMessage,
  UnknownRecord,
} from "@honk/api/core/v1";
import type { ThreadState } from "@honk/sdk";
import { TextField } from "@honk/ui/text-field";

import { formatTimestamp } from "./format";
import { ActionButton, BodyText, DetailText, useHonkTheme } from "./ui";

interface ConversationProps {
  readonly state: ThreadState;
  readonly onAnswerQuestion: (questionId: QuestionId, answers: UnknownRecord) => Promise<void>;
  readonly onCancelQueued: (messageId: MessageId) => Promise<void>;
  readonly onMoveQueued: (
    messageId: MessageId,
    targetMessageId: MessageId,
    insertAfter: boolean,
  ) => Promise<void>;
  readonly onSendQueuedNow: (messageId: MessageId) => Promise<void>;
  readonly onUpdateQueued: (messageId: MessageId, text: string) => Promise<void>;
  readonly onImplementPlan: (planId: PlanId, markdown: string) => Promise<void>;
  readonly onLoadAttachment: (attachmentId: AttachmentId) => Promise<Uint8Array>;
  readonly onLoadTurnDiff: (turn: number) => Promise<ReadonlyArray<FileDiff>>;
  readonly onRevertTurn: (turn: number) => Promise<void>;
}

const textForUserMessage = (message: Message, parts: ReadonlyArray<Part>): string => {
  const text: Array<string> = [];
  for (const part of parts) {
    if (part.messageId === message.id && part._tag === "text") text.push(part.text);
  }
  return text.join("");
};

function AttachmentImage({
  attachment,
  onLoad,
}: {
  readonly attachment: AttachmentRef;
  readonly onLoad: (attachmentId: AttachmentId) => Promise<Uint8Array>;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [uri, setUri] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const file = new File(Paths.cache, `honk-${String(attachment.id)}-${safeName}`);
        if (!file.exists) {
          const bytes = await onLoad(attachment.id);
          file.create({ intermediates: true, overwrite: true });
          file.write(bytes);
        }
        if (active) setUri(file.uri);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "The image could not be loaded.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attachment.id, attachment.name, onLoad]);

  if (uri === null) {
    return (
      <View
        style={[
          styles.remoteImagePlaceholder,
          {
            backgroundColor: theme.colors.layer01,
            borderRadius: theme.metrics.radius.panel,
            padding: theme.metrics.space.panelPad,
          },
        ]}
      >
        {error === null ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : (
          <DetailText style={{ color: theme.colors.errFg }}>{error}</DetailText>
        )}
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityHint="Opens the image full screen"
        accessibilityLabel={attachment.name}
        accessibilityRole="imagebutton"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({ opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1 })}
      >
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={{ uri }}
          style={[styles.remoteImage, { borderRadius: theme.metrics.radius.panel }]}
        />
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} visible={open}>
        <View style={[styles.lightbox, { backgroundColor: theme.colors.bgBase }]}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={{ uri }}
            style={styles.lightboxImage}
          />
          <View
            style={[
              styles.lightboxClose,
              {
                right: theme.metrics.space.screenGutter,
                top: theme.metrics.space.screenGutter,
              },
            ]}
          >
            <ActionButton label="Close image" onPress={() => setOpen(false)} tone="neutral" />
          </View>
        </View>
      </Modal>
    </>
  );
}

const toolSummary = (part: Extract<Part, { readonly _tag: "tool" }>): string => {
  const display = part.display;
  switch (display._tag) {
    case "bash":
      return display.command;
    case "read":
      return display.path;
    case "grep":
      return `${display.query}${display.path === undefined ? "" : ` · ${display.path}`}`;
    case "find":
      return `${display.query}${display.path === undefined ? "" : ` · ${display.path}`}`;
    case "edit":
      return `${display.files.length} file${display.files.length === 1 ? "" : "s"}`;
    case "mcp":
      return `${display.server}${display.toolName === undefined ? "" : ` · ${display.toolName}`}`;
    case "subagent":
      return `${display.runs.length} subagent${display.runs.length === 1 ? "" : "s"}`;
    case "web":
      return display.query ?? display.url ?? display.kind;
    case "image":
      return display.path ?? "Image output";
    case "diagnostic":
      return display.message;
    case "raw":
      return display.text.split("\n", 1)[0] ?? part.tool;
    case "generic":
      return part.tool;
  }
};

const toolOutput = (part: Extract<Part, { readonly _tag: "tool" }>): string | null => {
  const display = part.display;
  switch (display._tag) {
    case "bash":
    case "read":
    case "grep":
    case "find":
    case "mcp":
    case "generic":
      return display.output ?? null;
    case "edit":
      return display.diff ?? display.files.map((file) => file.path).join("\n");
    case "subagent":
      return display.runs
        .map((run) => `${run.label}: ${run.status}${run.finalText === undefined ? "" : `\n${run.finalText}`}`)
        .join("\n\n");
    case "web":
      return display.url ?? display.query ?? null;
    case "image":
      return display.path ?? null;
    case "diagnostic":
      return display.message;
    case "raw":
      return display.text;
  }
};

function ToolPart({ part }: { readonly part: Extract<Part, { readonly _tag: "tool" }> }): React.ReactElement {
  const theme = useHonkTheme();
  const [expanded, setExpanded] = React.useState(false);
  const output = toolOutput(part);
  const error = part.toolState._tag === "error" ? part.toolState.error : null;
  return (
    <Pressable
      accessibilityHint={output === null && error === null ? undefined : "Expands tool details"}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        if (output !== null || error !== null) setExpanded((current) => !current);
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.layer01,
          borderColor: error === null ? theme.colors.borderMuted : theme.colors.errBorder,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          gap: theme.metrics.space.compactGap,
          opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      <View style={styles.toolHeader}>
        <BodyText style={{ flex: 1, fontWeight: theme.metrics.font.weightSemibold }}>
          {part.tool}
        </BodyText>
        <DetailText>{part.toolState._tag}</DetailText>
      </View>
      <DetailText numberOfLines={expanded ? undefined : 2}>{toolSummary(part)}</DetailText>
      {expanded && output !== null ? (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <Text
            selectable
            style={{
              color: theme.colors.textPrimary,
              fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
              fontSize: theme.metrics.font.captionSize,
              lineHeight: theme.metrics.font.detailLeading,
            }}
          >
            {output}
          </Text>
        </ScrollView>
      ) : null}
      {expanded && error !== null ? (
        <DetailText selectable style={{ color: theme.colors.errFg }}>
          {error}
        </DetailText>
      ) : null}
      {part.diagnostics?.map((diagnostic, index) => (
        <DetailText
          key={`${diagnostic.severity}-${index}`}
          style={{ color: diagnostic.severity === "error" ? theme.colors.errFg : theme.colors.warnFg }}
        >
          {diagnostic.message}
        </DetailText>
      ))}
    </Pressable>
  );
}

function PatchPart({
  onLoad,
  onRevert,
  part,
}: {
  readonly onLoad: (turn: number) => Promise<ReadonlyArray<FileDiff>>;
  readonly onRevert: (turn: number) => Promise<void>;
  readonly part: Extract<Part, { readonly _tag: "patch" }>;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [files, setFiles] = React.useState<ReadonlyArray<FileDiff> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [reverting, setReverting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const toggle = async (): Promise<void> => {
    if (files !== null) {
      setFiles(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      setFiles(await onLoad(part.turn));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The checkpoint diff could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  const confirmRevert = (): void => {
    Alert.alert(
      `Revert turn ${part.turn}?`,
      "Core will restore the project files to their state before this turn. Conversation history is unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert files",
          style: "destructive",
          onPress: () => {
            setReverting(true);
            setMessage(null);
            void onRevert(part.turn)
              .then(() => setMessage("Project files reverted."))
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : "The turn could not be reverted."),
              )
              .finally(() => setReverting(false));
          },
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.layer01,
          borderColor: theme.colors.borderMuted,
          borderRadius: theme.metrics.radius.panel,
          borderWidth: theme.metrics.field.borderWidth,
          gap: theme.metrics.space.contentGap,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
        Changed {part.files.length} file{part.files.length === 1 ? "" : "s"}
      </BodyText>
      {part.files.map((file) => (
        <View
          key={file.path}
          style={[styles.patchFileSummary, { gap: theme.metrics.space.compactGap }]}
        >
          <DetailText numberOfLines={1} style={{ flex: 1 }}>
            {file.path}
          </DetailText>
          <DetailText style={{ color: theme.colors.okFg }}>+{file.additions}</DetailText>
          <DetailText style={{ color: theme.colors.errFg }}>−{file.deletions}</DetailText>
        </View>
      ))}
      {files?.map((file) => (
        <View key={file.path} style={{ gap: theme.metrics.space.compactGap }}>
          <BodyText>{file.path}</BodyText>
          {file.before === null ? null : (
            <ScrollView
              horizontal
              style={{ maxHeight: theme.metrics.composer.maxHeight }}
            >
              <Text
                selectable
                style={{
                  color: theme.colors.errFg,
                  fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
                  fontSize: theme.metrics.font.captionSize,
                }}
              >
                {file.before}
              </Text>
            </ScrollView>
          )}
          {file.after === null ? null : (
            <ScrollView
              horizontal
              style={{ maxHeight: theme.metrics.composer.maxHeight }}
            >
              <Text
                selectable
                style={{
                  color: theme.colors.okFg,
                  fontFamily: process.env.EXPO_OS === "ios" ? "Menlo" : "monospace",
                  fontSize: theme.metrics.font.captionSize,
                }}
              >
                {file.after}
              </Text>
            </ScrollView>
          )}
        </View>
      ))}
      {message === null ? null : <DetailText accessibilityLiveRegion="polite">{message}</DetailText>}
      <View style={[styles.patchActions, { gap: theme.metrics.space.contentGap }]}>
        <ActionButton
          label={files === null ? "View diff" : "Hide diff"}
          onPress={() => void toggle()}
          pending={loading}
          tone="neutral"
        />
        <ActionButton
          label="Revert files"
          onPress={confirmRevert}
          pending={reverting}
          tone="destructive"
        />
      </View>
    </View>
  );
}

function QuestionPart({
  onAnswer,
  part,
}: {
  readonly onAnswer: (answers: UnknownRecord) => Promise<void>;
  readonly part: Extract<Part, { readonly _tag: "question" }>;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [selected, setSelected] = React.useState<Record<string, ReadonlyArray<string>>>({});
  const [custom, setCustom] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const toggle = (questionId: string, option: string, multiSelect: boolean): void => {
    setSelected((current) => {
      const currentValues = current[questionId] ?? [];
      const currentSet = new Set(currentValues);
      if (currentSet.has(option)) currentSet.delete(option);
      else currentSet.add(option);
      const values = multiSelect ? [...currentSet] : [option];
      return { ...current, [questionId]: values };
    });
  };

  const submit = async (): Promise<void> => {
    const answers: Record<string, string | ReadonlyArray<string>> = {};
    for (const question of part.questions) {
      const key = String(question.id);
      const customValue = custom[key]?.trim() ?? "";
      const selectedValues = selected[key] ?? [];
      if (customValue !== "") answers[key] = customValue;
      else if (question.multiSelect === true && selectedValues.length > 0) answers[key] = selectedValues;
      else if (selectedValues[0] !== undefined) answers[key] = selectedValues[0];
      else {
        setError("Answer every question before sending.");
        return;
      }
    }
    setPending(true);
    setError(null);
    try {
      await onAnswer(answers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The answer could not be sent.");
    } finally {
      setPending(false);
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
      <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>{part.title}</BodyText>
      {part.questions.map((question) => {
        const key = String(question.id);
        const current = selected[key] ?? [];
        const currentSet = new Set(current);
        return (
          <View key={key} style={{ gap: theme.metrics.space.contentGap }}>
            <BodyText>{question.text}</BodyText>
            {question.options.map((option) => {
              const checked = currentSet.has(option.label);
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole={question.multiSelect === true ? "checkbox" : "radio"}
                  accessibilityState={{ checked }}
                  onPress={() => toggle(key, option.label, question.multiSelect === true)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: checked ? theme.colors.accentSubtle : theme.colors.layer01,
                      borderColor: checked ? theme.colors.accent : theme.colors.borderBase,
                      borderRadius: theme.metrics.radius.control,
                      borderWidth: theme.metrics.field.borderWidth,
                      minHeight: theme.metrics.interaction.touchTarget,
                      opacity: pressed ? theme.metrics.interaction.pressedOpacity : 1,
                      paddingHorizontal: theme.metrics.space.panelPad,
                    },
                  ]}
                >
                  <BodyText>{option.label}</BodyText>
                  {option.description === undefined ? null : (
                    <DetailText>{option.description}</DetailText>
                  )}
                </Pressable>
              );
            })}
            <TextField
              autoCapitalize="sentences"
              label="Other response"
              onChangeText={(value) => setCustom((current) => ({ ...current, [key]: value }))}
              placeholder="Type a custom answer"
              value={custom[key] ?? ""}
            />
          </View>
        );
      })}
      {error === null ? null : <DetailText style={{ color: theme.colors.errFg }}>{error}</DetailText>}
      <ActionButton label="Send answer" onPress={() => void submit()} pending={pending} />
    </View>
  );
}

function PartView({
  onAnswerQuestion,
  onImplementPlan,
  onLoadAttachment,
  onLoadTurnDiff,
  onRevertTurn,
  part,
}: {
  readonly onAnswerQuestion: ConversationProps["onAnswerQuestion"];
  readonly onImplementPlan: ConversationProps["onImplementPlan"];
  readonly onLoadAttachment: ConversationProps["onLoadAttachment"];
  readonly onLoadTurnDiff: ConversationProps["onLoadTurnDiff"];
  readonly onRevertTurn: ConversationProps["onRevertTurn"];
  readonly part: Part;
}): React.ReactElement | null {
  const theme = useHonkTheme();
  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: theme.colors.layer01,
      borderColor: theme.colors.borderMuted,
      borderRadius: theme.metrics.radius.panel,
      borderWidth: theme.metrics.field.borderWidth,
      gap: theme.metrics.space.compactGap,
      padding: theme.metrics.space.panelPad,
    },
  ];

  switch (part._tag) {
    case "text":
      return part.text === "" ? null : <BodyText selectable>{part.text}</BodyText>;
    case "reasoning":
      return part.text === "" ? null : (
        <View style={{ gap: theme.metrics.space.compactGap }}>
          <DetailText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Reasoning</DetailText>
          <DetailText selectable>{part.text}</DetailText>
        </View>
      );
    case "tool":
      return <ToolPart part={part} />;
    case "file":
      return (
        <View style={cardStyle}>
          <BodyText>{part.attachment.name}</BodyText>
          <DetailText>{part.attachment.mimeType}</DetailText>
        </View>
      );
    case "image":
      return <AttachmentImage attachment={part.attachment} onLoad={onLoadAttachment} />;
    case "plan":
      return (
        <View style={cardStyle}>
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            {part.summary ?? "Plan"}
          </BodyText>
          <BodyText selectable>{part.markdown}</BodyText>
          {part.state === "active" ? (
            <DetailText>Planning…</DetailText>
          ) : part.implementedAt !== null ? (
            <DetailText>Implementation started {formatTimestamp(part.implementedAt)}</DetailText>
          ) : (
            <ActionButton
              label="Implement plan"
              onPress={() => void onImplementPlan(part.planId, part.markdown)}
            />
          )}
        </View>
      );
    case "question":
      return part.status === "answered" ? (
        <View style={cardStyle}>
          <BodyText>{part.title}</BodyText>
          <DetailText>Answered</DetailText>
        </View>
      ) : part.state === "complete" ? (
        <View style={cardStyle}>
          <BodyText>{part.title}</BodyText>
          <DetailText>This question expired when the turn ended.</DetailText>
        </View>
      ) : (
        <QuestionPart onAnswer={(answers) => onAnswerQuestion(part.questionId, answers)} part={part} />
      );
    case "step":
      return part.state === "active" ? <DetailText>Working…</DetailText> : null;
    case "patch":
      return (
        <PatchPart
          onLoad={onLoadTurnDiff}
          onRevert={onRevertTurn}
          part={part}
        />
      );
    case "compaction":
      return <DetailText>{part.summary}</DetailText>;
    case "branchSummary":
      return <DetailText>{part.summary}</DetailText>;
    case "notice":
      return (
        <View style={[cardStyle, { backgroundColor: theme.colors.errBg, borderColor: theme.colors.errBorder }]}>
          <BodyText style={{ color: theme.colors.errFg }}>{part.name}</BodyText>
          <DetailText style={{ color: theme.colors.errFg }}>{part.message}</DetailText>
        </View>
      );
    case "custom":
      return (
        <View style={cardStyle}>
          <BodyText>{part.extensionTag}</BodyText>
          <DetailText>Extension content is available on the desktop client.</DetailText>
        </View>
      );
  }
}

function QueuedMessageView({
  moveDownTarget,
  moveUpTarget,
  onCancel,
  onMove,
  onSendNow,
  onUpdate,
  queued,
}: {
  readonly moveDownTarget: MessageId | null;
  readonly moveUpTarget: MessageId | null;
  readonly onCancel: (messageId: MessageId) => Promise<void>;
  readonly onMove: (
    messageId: MessageId,
    targetMessageId: MessageId,
    insertAfter: boolean,
  ) => Promise<void>;
  readonly onSendNow: (messageId: MessageId) => Promise<void>;
  readonly onUpdate: (messageId: MessageId, text: string) => Promise<void>;
  readonly queued: QueuedMessage;
}): React.ReactElement {
  const theme = useHonkTheme();
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(queued.text);
  const [pending, setPending] = React.useState<"cancel" | "move" | "send" | "update" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setEditText(queued.text), [queued.text]);

  const run = async (
    action: NonNullable<typeof pending>,
    operation: () => Promise<void>,
    fallback: string,
  ): Promise<void> => {
    setPending(action);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setPending(null);
    }
  };

  const save = async (): Promise<void> => {
    await run(
      "update",
      async () => {
        await onUpdate(queued.messageId, editText.trim());
        setEditing(false);
      },
      "The queued message could not be updated.",
    );
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
          gap: theme.metrics.space.compactGap,
          padding: theme.metrics.space.panelPad,
        },
      ]}
    >
      <DetailText style={{ color: theme.colors.warnFg }}>
        Queued · {queued.interactionMode}
      </DetailText>
      {editing ? (
        <TextField
          autoCapitalize="sentences"
          label="Queued message"
          minRows={2}
          multiline
          onChangeText={setEditText}
          value={editText}
        />
      ) : queued.text === "" ? null : (
        <BodyText>{queued.text}</BodyText>
      )}
      {queued.attachments.length === 0 ? null : (
        <DetailText>{queued.attachments.length} image attachment(s)</DetailText>
      )}
      {error === null ? null : <DetailText style={{ color: theme.colors.errFg }}>{error}</DetailText>}
      <View
        style={[
          styles.queueAction,
          { gap: theme.metrics.space.contentGap },
        ]}
      >
        {editing ? (
          <>
            <ActionButton
              label="Cancel edit"
              onPress={() => {
                setEditText(queued.text);
                setEditing(false);
              }}
              tone="neutral"
            />
            <ActionButton
              disabled={editText.trim() === "" && queued.attachments.length === 0}
              label="Save"
              onPress={() => void save()}
              pending={pending === "update"}
            />
          </>
        ) : (
          <>
            <ActionButton label="Edit" onPress={() => setEditing(true)} tone="neutral" />
            <ActionButton
              disabled={moveUpTarget === null}
              label="Move up"
              onPress={() => {
                if (moveUpTarget === null) return;
                void run(
                  "move",
                  () => onMove(queued.messageId, moveUpTarget, false),
                  "The queued message could not be moved.",
                );
              }}
              pending={pending === "move"}
              tone="neutral"
            />
            <ActionButton
              disabled={moveDownTarget === null}
              label="Move down"
              onPress={() => {
                if (moveDownTarget === null) return;
                void run(
                  "move",
                  () => onMove(queued.messageId, moveDownTarget, true),
                  "The queued message could not be moved.",
                );
              }}
              pending={pending === "move"}
              tone="neutral"
            />
            <ActionButton
              label="Send now"
              onPress={() =>
                void run(
                  "send",
                  () => onSendNow(queued.messageId),
                  "The queued message could not be sent now.",
                )
              }
              pending={pending === "send"}
            />
            <ActionButton
              label="Cancel"
              onPress={() =>
                void run(
                  "cancel",
                  () => onCancel(queued.messageId),
                  "The queued message could not be cancelled.",
                )
              }
              pending={pending === "cancel"}
              tone="destructive"
            />
          </>
        )}
      </View>
    </View>
  );
}

export function Conversation({
  onAnswerQuestion,
  onCancelQueued,
  onImplementPlan,
  onLoadAttachment,
  onLoadTurnDiff,
  onMoveQueued,
  onRevertTurn,
  onSendQueuedNow,
  onUpdateQueued,
  state,
}: ConversationProps): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View style={{ gap: theme.metrics.space.sectionGap }}>
      {state.messages.map((message) => {
        const messageParts = state.parts.filter((part) => part.messageId === message.id);
        if (message.role === "user") {
          const text = textForUserMessage(message, messageParts);
          return (
            <View
              key={String(message.id)}
              style={[
                styles.userMessage,
                {
                  backgroundColor: theme.colors.messageBubbleBg,
                  borderColor: theme.colors.messageBubbleRing,
                  borderRadius: theme.metrics.radius.bubble,
                  borderWidth: theme.metrics.field.borderWidth,
                  gap: theme.metrics.space.compactGap,
                  marginLeft: theme.metrics.space.screenGutter,
                  padding: theme.metrics.space.panelPad,
                },
              ]}
            >
              <BodyText selectable>{text}</BodyText>
              {message.attachments.map((attachment) =>
                attachment.mimeType.startsWith("image/") ? (
                  <AttachmentImage
                    key={String(attachment.id)}
                    attachment={attachment}
                    onLoad={onLoadAttachment}
                  />
                ) : (
                  <DetailText key={String(attachment.id)}>{attachment.name}</DetailText>
                ),
              )}
              <DetailText>{formatTimestamp(message.createdAt)}</DetailText>
            </View>
          );
        }
        return (
          <View key={String(message.id)} style={{ gap: theme.metrics.space.contentGap }}>
            {messageParts.map((part) => (
              <PartView
                key={String(part.id)}
                onAnswerQuestion={onAnswerQuestion}
                onImplementPlan={onImplementPlan}
                onLoadAttachment={onLoadAttachment}
                onLoadTurnDiff={onLoadTurnDiff}
                onRevertTurn={onRevertTurn}
                part={part}
              />
            ))}
            {message.error === null ? null : (
              <DetailText style={{ color: theme.colors.errFg }}>{message.error}</DetailText>
            )}
          </View>
        );
      })}
      {state.queue.map((queued, index) => (
        <QueuedMessageView
          key={String(queued.messageId)}
          moveDownTarget={state.queue[index + 1]?.messageId ?? null}
          moveUpTarget={state.queue[index - 1]?.messageId ?? null}
          onCancel={onCancelQueued}
          onMove={onMoveQueued}
          onSendNow={onSendQueuedNow}
          onUpdate={onUpdateQueued}
          queued={queued}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
  },
  option: {
    justifyContent: "center",
  },
  userMessage: {
    alignSelf: "flex-end",
  },
  queueAction: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  remoteImage: {
    aspectRatio: 4 / 3,
    width: "100%",
  },
  remoteImagePlaceholder: {
    alignItems: "center",
    aspectRatio: 4 / 3,
    justifyContent: "center",
    width: "100%",
  },
  lightbox: {
    flex: 1,
    justifyContent: "center",
  },
  lightboxImage: {
    height: "100%",
    width: "100%",
  },
  lightboxClose: {
    position: "absolute",
  },
  toolHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  patchFileSummary: {
    alignItems: "center",
    flexDirection: "row",
  },
  patchActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
});
