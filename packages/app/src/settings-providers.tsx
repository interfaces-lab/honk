import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Field, Spinner, Text } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import {
  providerAuthActions,
  type OpenAiFlow,
  type OpenCodeGoFlow,
  useProviderAuth,
} from "./provider-auth";
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";

const styles = stylex.create({
  flow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
});

function ValueForm(props: {
  readonly label: string;
  readonly placeholder?: string;
  readonly secret?: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (value: string) => Promise<void>;
  readonly onCancel: () => void;
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
      <Text size="sm" weight="regular">
        {props.label}
      </Text>
      <Field>
        <Field.Input
          autoFocus
          aria-label={props.label}
          type={props.secret === true ? "password" : "text"}
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
        <Button type="button" variant="quiet" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OpenAiFlowPanel({ flow }: { readonly flow: OpenAiFlow }): React.ReactElement | null {
  if (flow.kind === "idle" || flow.kind === "disconnecting") return null;
  if (flow.kind === "authorizing" || flow.kind === "waiting") {
    return (
      <div {...stylex.props(styles.flow)}>
        <div {...stylex.props(styles.actions)}>
          <Spinner size="sm" />
          <Text size="sm" tone="muted">
            {flow.kind === "authorizing" ? `Starting ${flow.label}…` : flow.instructions}
          </Text>
        </div>
        <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    );
  }
  if (flow.kind === "choosing") {
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm" weight="regular">
          Choose how to connect Codex
        </Text>
        <div {...stylex.props(styles.actions)}>
          {flow.methods.map((method) => (
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
          <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (flow.kind === "prompt") {
    const prompt = flow.cursor.prompt;
    if (prompt.type === "select") {
      return (
        <div {...stylex.props(styles.flow)}>
          <Text size="sm" weight="regular">
            {prompt.message}
          </Text>
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
            <Button variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
              Cancel
            </Button>
          </div>
        </div>
      );
    }
    return (
      <ValueForm
        key={`${String(flow.method.index)}:${String(flow.cursor.index)}`}
        label={prompt.message}
        {...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })}
        submitLabel="Continue"
        onSubmit={providerAuthActions.submitOpenAiPrompt}
        onCancel={providerAuthActions.cancelOpenAi}
      />
    );
  }
  if (flow.kind === "code") {
    return (
      <ValueForm
        label={flow.instructions.length > 0 ? flow.instructions : "Paste the authorization code"}
        submitLabel="Finish sign in"
        onSubmit={providerAuthActions.submitOpenAiCode}
        onCancel={providerAuthActions.cancelOpenAi}
      />
    );
  }
  return (
    <ValueForm
      label="OpenAI API key"
      placeholder="sk-…"
      secret
      submitLabel="Save API key"
      onSubmit={providerAuthActions.submitOpenAiApiKey}
      onCancel={providerAuthActions.cancelOpenAi}
    />
  );
}

function OpenCodeGoFlowPanel({
  flow,
}: {
  readonly flow: OpenCodeGoFlow;
}): React.ReactElement | null {
  if (flow.kind === "idle") return null;
  if (flow.kind === "saving") {
    return (
      <div {...stylex.props(styles.actions)}>
        <Spinner size="sm" />
        <Text size="sm" tone="muted">
          Saving OpenCode Go key…
        </Text>
      </div>
    );
  }
  return (
    <ValueForm
      label="OpenCode API key"
      secret
      submitLabel="Save API key"
      onSubmit={providerAuthActions.submitOpenCodeGoApiKey}
      onCancel={providerAuthActions.cancelOpenCodeGo}
    />
  );
}

export function SettingsProviders(): React.ReactElement {
  const state = useProviderAuth();
  const providerFlowBusy = state.openAi.kind !== "idle" || state.openCodeGo.kind !== "idle";
  const anthropic =
    state.anthropic.kind === "connected"
      ? { tone: "ok" as const, label: "Connected" }
      : state.anthropic.kind === "failed"
        ? { tone: "err" as const, label: "Import failed" }
        : state.anthropic.kind === "unavailable"
          ? { tone: "neutral" as const, label: "Not detected" }
          : { tone: "neutral" as const, label: "Checking…" };

  return (
    <SettingsSection
      title="Authentication"
      description="Connect Codex or OpenCode Go here. Honk imports Claude Code credentials from this computer."
    >
      <SettingsRows>
        <SettingsRow
          title="Codex"
          description={
            state.openAiConnected
              ? "Connected to an OpenAI coding account."
              : "Sign in with ChatGPT or add an OpenAI API key."
          }
          control={
            state.openAiConnected ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={providerFlowBusy}
                onClick={() => {
                  void providerAuthActions.disconnectOpenAi();
                }}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                variant="neutral"
                disabled={state.phase === "unavailable" || providerFlowBusy}
                onClick={() => {
                  void providerAuthActions.startOpenAi();
                }}
              >
                Connect
              </Button>
            )
          }
        />
        <SettingsRow
          title="OpenCode Go"
          description={
            state.openCodeGoConnected
              ? "Connected with OPENCODE_API_KEY or a saved OpenCode key."
              : "Uses OPENCODE_API_KEY from your environment, or add an OpenCode key here."
          }
          control={
            <Button
              size="sm"
              variant={state.openCodeGoConnected ? "quiet" : "neutral"}
              disabled={state.phase === "unavailable" || providerFlowBusy}
              onClick={() => {
                void providerAuthActions.startOpenCodeGo();
              }}
            >
              {state.openCodeGoConnected ? "Replace key" : "Add key"}
            </Button>
          }
        />
        <SettingsRow
          title="Claude Code"
          description={
            state.anthropic.kind === "failed"
              ? state.anthropic.message
              : "Honk checks this computer for Claude Code credentials."
          }
          isLast
          control={
            <div {...stylex.props(styles.actions)}>
              <Badge tone={anthropic.tone}>{anthropic.label}</Badge>
              {state.anthropic.kind === "failed" || state.anthropic.kind === "unavailable" ? (
                <Button
                  size="sm"
                  variant="neutral"
                  disabled={providerFlowBusy}
                  onClick={() => {
                    void providerAuthActions.retryAnthropic();
                  }}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          }
        />
      </SettingsRows>
      <OpenAiFlowPanel flow={state.openAi} />
      <OpenCodeGoFlowPanel flow={state.openCodeGo} />
      {state.errorMessage === null ? null : (
        <Text as="p" role="alert" size="sm" tone="err">
          {state.errorMessage}
        </Text>
      )}
    </SettingsSection>
  );
}
