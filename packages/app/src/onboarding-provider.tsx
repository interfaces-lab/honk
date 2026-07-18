// Provider step of the desktop onboarding. Follows the step system: the copy
// column owns the decision (account rows + the Codex auth flow), the stage
// panel shows the consequence (which account powers the composer, live).

import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Field, ListRow, Spinner, Text } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { ProviderDemo } from "./onboarding-demo";
import { OnboardingStepCopy, OnboardingStepPanel, onboardingStepStyles } from "./onboarding-step";
import { providerAuthActions, type OpenAiFlow, useProviderAuth } from "./provider-auth";

const styles = stylex.create({
  rows: {
    width: "100%",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  flow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
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
      <Text size="sm" weight="regular">{props.label}</Text>
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
        <Text size="sm" weight="regular">Choose a Codex sign-in method</Text>
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
          <Text size="sm" weight="regular">{prompt.message}</Text>
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

export function OnboardingProviderStep(props: {
  readonly onBack: () => void;
  readonly onContinue: () => void;
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
    <div {...stylex.props(onboardingStepStyles.stage)}>
      <div {...stylex.props(onboardingStepStyles.body)}>
        <OnboardingStepCopy step="provider" title="Set up coding accounts">
          <Text as="p" size="base" tone="muted">
            Codex sign-in is optional. Honk imports Claude Code credentials when the Claude Code
            plugin is installed.
          </Text>
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
          <Text as="p" size="sm" tone="faint">
            Connect or disconnect accounts at any time in Settings.
          </Text>
        </OnboardingStepCopy>
        <OnboardingStepPanel label="Connected account preview">
          <ProviderDemo
            codexConnected={state.openAiConnected}
            claudeConnected={state.anthropic.kind === "connected"}
          />
        </OnboardingStepPanel>
      </div>
      <div {...stylex.props(onboardingStepStyles.footer)}>
        <Button size="md" variant="quiet" onClick={props.onBack}>Back</Button>
        <span {...stylex.props(onboardingStepStyles.footerSpacer)} />
        <Button autoFocus size="md" variant="primary" onClick={props.onContinue}>
          {state.openAiConnected ? "Continue" : "Continue without connecting"}
        </Button>
      </div>
    </div>
  );
}
