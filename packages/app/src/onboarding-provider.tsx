import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Field, ListRow, Spinner, Text } from "@honk/ui";
import { colorVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { providerAuthActions, type OpenAiFlow, useProviderAuth } from "./provider-auth";

const styles = stylex.create({
  stage: { minHeight: 0, flexGrow: 1, display: "flex", flexDirection: "column" },
  body: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  heading: { display: "flex", flexDirection: "column", gap: spaceVars["--honk-space-gutter"] },
  panel: {
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  rows: { display: "flex", flexDirection: "column" },
  flow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    marginTop: spaceVars["--honk-space-gutter"],
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
  spacer: { flexGrow: 1 },
});

function TextPrompt(props: {
  readonly label: string;
  readonly placeholder?: string;
  readonly submitLabel: string;
  readonly onSubmit: (value: string) => Promise<void>;
}): React.ReactElement {
  const [value, setValue] = React.useState("");
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSubmit(value);
      }}
    >
      <Text size="sm" weight="medium">{props.label}</Text>
      <Field>
        <Field.Input
          autoFocus
          aria-label={props.label}
          value={value}
          {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </Field>
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" variant="primary" disabled={value.trim().length === 0}>
          {props.submitLabel}
        </Button>
        <Button type="button" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CodexFlow({ flow }: { readonly flow: OpenAiFlow }): React.ReactElement | null {
  if (flow.kind === "idle") return null;
  if (flow.kind === "authorizing" || flow.kind === "waiting") {
    return (
      <div {...stylex.props(styles.flow)}>
        <div {...stylex.props(styles.actions)}>
          <Spinner size="sm" />
          <Text size="sm" tone="muted">Waiting for Codex authorization…</Text>
        </div>
        <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>Cancel</Button>
      </div>
    );
  }
  if (flow.kind === "disconnecting" || flow.kind === "apiKey") {
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm" tone="muted">
          API keys and disconnect controls are available later in Settings.
        </Text>
        <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>Cancel</Button>
      </div>
    );
  }
  if (flow.kind === "choosing") {
    const methods = flow.methods.filter((method) => method.type === "oauth");
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm" weight="medium">Choose a Codex sign-in method</Text>
        {methods.length === 0 ? (
          <Text size="sm" tone="muted">
            Codex sign-in is unavailable. Continue now, then add an API key in Settings.
          </Text>
        ) : (
          <div {...stylex.props(styles.actions)}>
            {methods.map((method) => (
              <Button
                key={method.index}
                variant="neutral"
                onClick={() => {
                  void providerAuthActions.chooseOpenAiMethod(method.index);
                }}
              >
                {method.label}
              </Button>
            ))}
          </div>
        )}
        <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>Cancel</Button>
      </div>
    );
  }
  if (flow.kind === "prompt") {
    const prompt = flow.cursor.prompt;
    if (prompt.type === "select") {
      return (
        <div {...stylex.props(styles.flow)}>
          <Text size="sm" weight="medium">{prompt.message}</Text>
          <div {...stylex.props(styles.actions)}>
            {prompt.options.map((option) => (
              <Button
                key={option.value}
                variant="neutral"
                onClick={() => {
                  void providerAuthActions.submitOpenAiPrompt(option.value);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>Cancel</Button>
        </div>
      );
    }
    return (
      <div {...stylex.props(styles.flow)}>
        <TextPrompt
          key={`${String(flow.method.index)}:${String(flow.cursor.index)}`}
          label={prompt.message}
          {...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })}
          submitLabel="Continue"
          onSubmit={providerAuthActions.submitOpenAiPrompt}
        />
      </div>
    );
  }
  return (
    <div {...stylex.props(styles.flow)}>
      <TextPrompt
        label={flow.instructions.length > 0 ? flow.instructions : "Paste the authorization code"}
        submitLabel="Finish sign in"
        onSubmit={providerAuthActions.submitOpenAiCode}
      />
    </div>
  );
}

export function OnboardingProvider(props: {
  readonly onBack: () => void;
  readonly onComplete: () => void;
  readonly isCompleting: boolean;
  readonly completionError: string | null;
}): React.ReactElement {
  const state = useProviderAuth();
  const anthropicLabel =
    state.anthropic.kind === "connected"
      ? "Connected"
      : state.anthropic.kind === "failed"
        ? "Import failed"
        : state.anthropic.kind === "unavailable"
          ? "Not detected"
          : "Checking…";

  return (
    <div {...stylex.props(styles.stage)}>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.heading)}>
          <Text as="p" size="lg" weight="semibold">Set up coding accounts</Text>
          <Text as="p" size="base" tone="muted">
            Codex sign-in is optional. Honk imports Claude Code credentials when the Claude Code
            plugin is installed.
          </Text>
        </div>
        <section {...stylex.props(styles.panel)} aria-label="Coding accounts">
          <div {...stylex.props(styles.rows)}>
            <ListRow>
              <ListRow.Content>
                <ListRow.Title>Codex</ListRow.Title>
                <ListRow.Description>Optional OpenAI coding account</ListRow.Description>
              </ListRow.Content>
              <ListRow.Meta>
                {state.openAiConnected ? (
                  <Badge tone="ok">Connected</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="neutral"
                    disabled={state.phase === "unavailable" || state.openAi.kind !== "idle"}
                    onClick={() => {
                      void providerAuthActions.startOpenAi();
                    }}
                  >
                    Connect
                  </Button>
                )}
              </ListRow.Meta>
            </ListRow>
            <ListRow disabled>
              <ListRow.Content>
                <ListRow.Title>Claude Code</ListRow.Title>
                <ListRow.Description>Imported from this computer</ListRow.Description>
              </ListRow.Content>
              <ListRow.Meta>
                <Badge
                  tone={
                    state.anthropic.kind === "connected"
                      ? "ok"
                      : state.anthropic.kind === "failed"
                        ? "err"
                        : "neutral"
                  }
                >
                  {anthropicLabel}
                </Badge>
              </ListRow.Meta>
            </ListRow>
          </div>
          <CodexFlow flow={state.openAi} />
          {state.errorMessage === null ? null : (
            <Text as="p" role="alert" size="sm" tone="err">{state.errorMessage}</Text>
          )}
          {props.completionError === null ? null : (
            <Text as="p" role="alert" size="sm" tone="err">{props.completionError}</Text>
          )}
        </section>
      </div>
      <div {...stylex.props(styles.footer)}>
        <Button size="md" variant="quiet" onClick={props.onBack}>Back</Button>
        <span {...stylex.props(styles.spacer)} />
        <Button
          autoFocus
          size="md"
          variant="primary"
          disabled={props.isCompleting}
          onClick={props.onComplete}
        >
          {props.isCompleting
            ? "Opening Honk…"
            : state.openAiConnected
              ? "Start using Honk"
              : "Continue without connecting"}
        </Button>
      </div>
    </div>
  );
}
