import * as stylex from "@stylexjs/stylex";
import { Button, Field, ListRow, Text, Tray } from "@honk/ui";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "../error-message";
import {
  rejectSessionQuestion,
  replySessionPermission,
  replySessionQuestion,
  type ThreadViewState,
} from "../open-code-view";
import { useThreadRuntime } from "./runtime";

const REQUEST_CARD_RING = `inset 0 0 0 1px ${colorVars["--honk-color-warn-border"]}`;
const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: spaceVars["--honk-space-gutter"] },
  trayHeader: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  trayStack: {
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    boxShadow: REQUEST_CARD_RING,
  },
  cardEmbedded: {
    padding: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: "none",
  },
  question: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
  },
});

type ThreadPermissionRequest = ThreadViewState["permissions"][number];
type ThreadQuestionRequest = ThreadViewState["questions"][number];
type SessionRequestsPresentation = "card" | "tray";

export function SessionRequestTray({
  threadId,
  permissions,
  questions,
}: {
  readonly threadId: string;
  readonly permissions: readonly ThreadPermissionRequest[];
  readonly questions: readonly ThreadQuestionRequest[];
}): React.ReactElement | null {
  if (permissions.length === 0 && questions.length === 0) return null;

  const questionCount = questions.reduce((count, request) => count + request.questions.length, 0);
  const title =
    questionCount === 0
      ? "Permission requested"
      : questionCount === 1
        ? (questions[0]?.questions[0]?.header ?? "Question")
        : `${String(questionCount)} questions`;

  return (
    <Tray aria-label={questionCount > 0 ? "Question from the agent" : "Permission requested"}>
      <Tray.Header rowsExpanded>
        <div {...stylex.props(styles.trayHeader)}>
          <Text size="sm" tone="muted">
            Needs you
          </Text>
          <Text size="base" weight="semibold" truncate>
            {title}
          </Text>
        </div>
      </Tray.Header>
      <Tray.ScrollArea aria-label="Agent requests" inset="block">
        <SessionRequests
          threadId={threadId}
          permissions={permissions}
          questions={questions}
          presentation="tray"
        />
      </Tray.ScrollArea>
    </Tray>
  );
}

export function SessionRequests({
  threadId,
  permissions,
  questions,
  presentation = "card",
}: {
  readonly threadId: string;
  readonly permissions: readonly ThreadPermissionRequest[];
  readonly questions: readonly ThreadQuestionRequest[];
  readonly presentation?: SessionRequestsPresentation;
}): React.ReactElement | null {
  if (permissions.length === 0 && questions.length === 0) return null;

  return (
    <div
      {...stylex.props(styles.stack, presentation === "tray" && styles.trayStack)}
      aria-label="Requests needing your input"
    >
      {questions.map((request) => (
        <QuestionRequestCard
          key={request.id}
          threadId={threadId}
          request={request}
          presentation={presentation}
        />
      ))}
      {permissions.map((request) => (
        <PermissionRequestCard
          key={request.id}
          threadId={threadId}
          request={request}
          presentation={presentation}
        />
      ))}
    </div>
  );
}

function QuestionRequestCard({
  threadId,
  request,
  presentation,
}: {
  readonly threadId: string;
  readonly request: ThreadQuestionRequest;
  readonly presentation: SessionRequestsPresentation;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const [answers, setAnswers] = React.useState<readonly (readonly string[])[]>(() =>
    request.questions.map(() => []),
  );
  const [custom, setCustom] = React.useState<readonly string[]>(() =>
    request.questions.map(() => ""),
  );
  const [pending, setPending] = React.useState<"answer" | "reject" | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  const toggleAnswer = (questionIndex: number, label: string, multiple: boolean): void => {
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

  const answer = (): void => {
    const resolved = answers.map((selected, index) => {
      const value = custom[index]?.trim() ?? "";
      return value.length > 0 ? [value] : selected;
    });
    if (resolved.some((selected) => selected.length === 0)) {
      setRequestError("Answer every question before sending.");
      return;
    }
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending("answer");
    setRequestError(null);
    void replySessionQuestion(client, threadId, request.id, {
      answers: resolved.map((selected) => [...selected]),
    })
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  const reject = (): void => {
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending("reject");
    setRequestError(null);
    void rejectSessionQuestion(client, threadId, request.id)
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <section
      tabIndex={-1}
      data-session-request=""
      {...stylex.props(styles.card, presentation === "tray" && styles.cardEmbedded)}
      aria-label="Question from the agent"
    >
      {request.questions.map((question, questionIndex) => (
        <div key={`${request.id}:${String(questionIndex)}`} {...stylex.props(styles.question)}>
          <Text as="p" size="xs" tone="faint" weight="semibold">
            {question.header}
          </Text>
          <Text as="p" size="sm" weight="regular">
            {question.question}
          </Text>
          <div
            role={question.multiple === true ? "group" : "radiogroup"}
            aria-label={question.header}
            {...stylex.props(styles.options)}
          >
            {question.options.map((option) => {
              const selected = answers[questionIndex]?.includes(option.label) ?? false;
              return (
                <ListRow
                  key={option.label}
                  role={question.multiple === true ? "checkbox" : "radio"}
                  aria-checked={selected}
                  isSelected={selected}
                  onClick={() => {
                    toggleAnswer(questionIndex, option.label, question.multiple === true);
                  }}
                >
                  <ListRow.Content>
                    <ListRow.Title>{option.label}</ListRow.Title>
                    <ListRow.Description>{option.description}</ListRow.Description>
                  </ListRow.Content>
                </ListRow>
              );
            })}
          </div>
          {question.custom === true ? (
            <Field size="md">
              <Field.Input
                value={custom[questionIndex] ?? ""}
                placeholder="Other response…"
                aria-label={`${question.header}: other response`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCustom((current) =>
                    current.map((entry, index) => (index === questionIndex ? value : entry)),
                  );
                }}
              />
            </Field>
          ) : null}
        </div>
      ))}
      {requestError === null ? null : (
        <Text as="p" role="alert" size="xs" tone="err">
          {requestError}
        </Text>
      )}
      <div {...stylex.props(styles.actions)}>
        <Button type="button" variant="quiet" disabled={pending !== null} onClick={reject}>
          {pending === "reject" ? "Dismissing…" : "Dismiss"}
        </Button>
        <Button type="button" variant="primary" disabled={pending !== null} onClick={answer}>
          {pending === "answer" ? "Sending…" : "Send answer"}
        </Button>
      </div>
    </section>
  );
}

function PermissionRequestCard({
  threadId,
  request,
  presentation,
}: {
  readonly threadId: string;
  readonly request: ThreadPermissionRequest;
  readonly presentation: SessionRequestsPresentation;
}): React.ReactElement {
  const runtime = useThreadRuntime();
  const [pending, setPending] = React.useState<"once" | "always" | "reject" | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  const reply = (value: "once" | "always" | "reject"): void => {
    const client = runtime.client;
    if (client === null) {
      setRequestError("The OpenCode connection is not ready yet.");
      return;
    }
    setPending(value);
    setRequestError(null);
    void replySessionPermission(client, threadId, request.id, value)
      .catch((cause: unknown) => {
        setRequestError(errorMessage(cause));
      })
      .finally(() => {
        setPending(null);
      });
  };

  return (
    <section
      tabIndex={-1}
      data-session-request=""
      {...stylex.props(styles.card, presentation === "tray" && styles.cardEmbedded)}
      aria-label="Permission requested by the agent"
    >
      <Text as="p" size="xs" tone="faint" weight="semibold">
        Permission requested
      </Text>
      <Text as="p" size="sm" weight="regular">
        {request.action}
      </Text>
      {request.resources.map((resource) => (
        <Text
          key={resource}
          as="p"
          size="xs"
          tone="faint"
          family="mono"
          style={{ overflowWrap: "anywhere" }}
        >
          {resource}
        </Text>
      ))}
      {requestError === null ? null : (
        <Text as="p" role="alert" size="xs" tone="err">
          {requestError}
        </Text>
      )}
      <div {...stylex.props(styles.actions)}>
        <Button
          type="button"
          variant="quiet"
          disabled={pending !== null}
          onClick={() => {
            reply("reject");
          }}
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <Button
          type="button"
          variant="neutral"
          disabled={pending !== null}
          onClick={() => {
            reply("once");
          }}
        >
          {pending === "once" ? "Allowing…" : "Allow once"}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={pending !== null}
          onClick={() => {
            reply("always");
          }}
        >
          {pending === "always" ? "Allowing…" : "Always allow"}
        </Button>
      </div>
    </section>
  );
}
