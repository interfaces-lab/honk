// The coding-accounts step of /setup. Codex sign-in runs the same OpenCode auth
// flow Settings uses; Claude Code is a read-only probe of the CLI already on
// this Mac, so it reports state and never offers a control it cannot honor.

import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Field, Icon, Spinner, Text } from "@honk/ui";
import { IconClawd, IconOpenaiCodex, IconUserKey } from "@honk/ui/icons";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { SetupFooter, SetupPanel, SetupRow, SetupScene } from "./setup-scene";
import { providerAuthActions, type OpenAiFlow, useProviderAuth } from "./provider-auth";

const styles = stylex.create({
  flow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
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
  note: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
});

export function SetupAccountsStep({
  onBack,
  onContinue,
}: {
  readonly onBack: () => void;
  readonly onContinue: () => void;
}): React.ReactElement {
  const state = useProviderAuth();

  return (
    <SetupScene
      icon={IconUserKey}
      title="Coding accounts"
      description="Honk runs threads on whichever of these you sign in to. Both are optional, and both can wait until Settings."
    >
      <SetupPanel label="Coding accounts">
        <SetupRow
          title="Codex"
          description="Sign in with your OpenAI account to run threads on Codex."
          control={
            state.openAiConnected ? (
              <Badge tone="ok">Connected</Badge>
            ) : (
              <Button
                size="sm"
                variant="neutral"
                disabled={state.phase === "unavailable" || state.openAi.kind !== "idle"}
                iconStart={<Icon icon={IconOpenaiCodex} size="sm" />}
                onClick={() => {
                  void providerAuthActions.startOpenAi();
                }}
              >
                Connect
              </Button>
            )
          }
        />
        <CodexFlow flow={state.openAi} />
        <SetupRow
          title="Claude Code"
          description={claudeDescription(state.claudeConnected)}
          control={
            state.claudeConnected === true ? (
              <Badge tone="ok">Signed in</Badge>
            ) : (
              <span {...stylex.props(styles.note)}>
                <Icon icon={IconClawd} size="sm" tone="faint" />
                <Text size="sm" tone="faint">
                  {state.claudeConnected === false ? "Not signed in" : "Checking…"}
                </Text>
              </span>
            )
          }
        />
      </SetupPanel>
      {state.errorMessage === null ? null : (
        <Text as="p" role="alert" size="sm" tone="err">
          {state.errorMessage}
        </Text>
      )}
      <SetupFooter
        onBack={onBack}
        onNext={onContinue}
        nextLabel={state.openAiConnected ? "Next" : "Skip for now"}
      />
    </SetupScene>
  );
}

function claudeDescription(connected: boolean | null): string {
  if (connected === true) {
    return "Honk uses the session already signed in on this Mac.";
  }
  if (connected === false) {
    return "Sign in once with the claude CLI and Honk picks that session up.";
  }
  return "Checking the claude CLI on this Mac.";
}

function CodexFlow({ flow }: { readonly flow: OpenAiFlow }): React.ReactElement | null {
  if (flow.kind === "idle") {
    return null;
  }

  if (flow.kind === "authorizing" || flow.kind === "waiting") {
    return (
      <div {...stylex.props(styles.flow)}>
        <div {...stylex.props(styles.actions)}>
          <Spinner size="sm" />
          <Text size="sm" tone="muted">
            Waiting for Codex authorization…
          </Text>
        </div>
        <Button size="sm" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    );
  }

  if (flow.kind === "disconnecting" || flow.kind === "apiKey") {
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm" tone="muted">
          API keys and disconnect controls live in Settings.
        </Text>
        <Button size="sm" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    );
  }

  if (flow.kind === "choosing") {
    const methods = flow.methods.filter((method) => method.type === "oauth");
    return (
      <div {...stylex.props(styles.flow)}>
        <Text size="sm">Choose a Codex sign-in method</Text>
        {methods.length === 0 ? (
          <Text size="sm" tone="muted">
            Codex sign-in is unavailable right now. Continue, then add an API key in Settings.
          </Text>
        ) : (
          <div {...stylex.props(styles.actions)}>
            {methods.map((method) => (
              <Button
                key={method.id}
                size="sm"
                variant="neutral"
                onClick={() => {
                  void providerAuthActions.chooseOpenAiMethod(method.id);
                }}
              >
                {method.label}
              </Button>
            ))}
          </div>
        )}
        <Button size="sm" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    );
  }

  if (flow.kind === "prompt") {
    const prompt = flow.cursor.prompt;
    if (prompt.type === "select") {
      return (
        <div {...stylex.props(styles.flow)}>
          <Text size="sm">{prompt.message}</Text>
          <div {...stylex.props(styles.actions)}>
            {prompt.options.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant="neutral"
                onClick={() => {
                  void providerAuthActions.submitOpenAiPrompt(option.value);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
            Cancel
          </Button>
        </div>
      );
    }
    return (
      <div {...stylex.props(styles.flow)}>
        <TextPrompt
          key={`${flow.method.id}:${String(flow.cursor.index)}`}
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

function TextPrompt({
  label,
  placeholder,
  submitLabel,
  onSubmit,
}: {
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
        void onSubmit(value);
      }}
    >
      <Text size="sm">{label}</Text>
      <Field>
        <Field.Input
          autoFocus
          aria-label={label}
          value={value}
          {...(placeholder === undefined ? {} : { placeholder })}
          onChange={(event) => {
            setValue(event.currentTarget.value);
          }}
        />
      </Field>
      <div {...stylex.props(styles.actions)}>
        <Button size="sm" type="submit" variant="primary" disabled={value.trim().length === 0}>
          {submitLabel}
        </Button>
        <Button size="sm" type="button" variant="quiet" onClick={providerAuthActions.cancelOpenAi}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
