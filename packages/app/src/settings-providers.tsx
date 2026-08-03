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
              key={method.type === "oauth" ? method.id : method.type}
              variant="neutral"
              onClick={() => {
                void providerAuthActions.chooseOpenAiMethod(
                  method.type === "oauth" ? method.id : method.type,
                );
              }}
            >
              {method.label ?? "API key"}
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
        key={`${flow.method.id}:${String(flow.cursor.index)}`}
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

  // Credentials change behind the app's back (terminal `claude login`, keys
  // added elsewhere), so re-check when the Accounts surface opens.
  React.useEffect(() => {
    void providerAuthActions.refresh();
  }, []);

  return (
    <SettingsSection description="Honk uses these accounts to run models.">
      <SettingsRows>
        <SettingsRow
          title="Claude Code"
          description={
            state.claudeConnected === false
              ? "Uses your Claude Code sign-in on this Mac. Sign in from your terminal, then check again."
              : "Uses your Claude Code sign-in on this Mac."
          }
          control={
            <div {...stylex.props(styles.actions)}>
              {state.claudeConnected === null ? null : (
                <Badge tone={state.claudeConnected ? "ok" : "neutral"}>
                  {state.claudeConnected ? "Connected" : "Not connected"}
                </Badge>
              )}
              <Button
                size="sm"
                variant="quiet"
                disabled={state.phase === "unavailable"}
                onClick={() => {
                  void providerAuthActions.refreshClaude();
                }}
              >
                Check again
              </Button>
            </div>
          }
        />
        <SettingsRow
          title="Codex"
          description="Uses your ChatGPT sign-in or an OpenAI API key."
          control={
            <div {...stylex.props(styles.actions)}>
              <Badge tone={state.openAiConnected ? "ok" : "neutral"}>
                {state.openAiConnected ? "Connected" : "Not connected"}
              </Badge>
              {state.openAiConnected ? (
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
              )}
            </div>
          }
        />
        <SettingsRow
          title="OpenCode Go"
          description="Uses OPENCODE_API_KEY or a saved OpenCode key."
          control={
            <div {...stylex.props(styles.actions)}>
              <Badge tone={state.openCodeGoConnected ? "ok" : "neutral"}>
                {state.openCodeGoConnected ? "Connected" : "Not connected"}
              </Badge>
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
            </div>
          }
          isLast
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
