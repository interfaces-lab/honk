// Unlocking a provider from the start page. API keys are entered here
// (models.setCredential); OAuth flows are interactive and provider-owned, so
// they run in a terminal via the core CLI — this surface names the command
// instead of pretending a text field could do it (spec/core.md section 11).

import { Button, Field, Text } from "@honk/ui";
import { borderVars, colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { ProviderSetup } from "./start-controller";

const SETUP_MAX_WIDTH = "440px";

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: SETUP_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-panel"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
  },
  row: {
    display: "flex",
    gap: spaceVars["--honk-space-gutter"],
    alignItems: "center",
  },
  select: {
    boxSizing: "border-box",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    backgroundColor: colorVars["--honk-color-bg-chrome"],
    color: colorVars["--honk-color-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  grow: {
    flexGrow: 1,
    minWidth: 0,
  },
  hint: {
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    color: colorVars["--honk-color-text-muted"],
    overflowWrap: "anywhere",
  },
  errorText: {
    fontSize: fontVars["--honk-font-size-detail"],
    color: colorVars["--honk-color-err-fg"],
  },
});

export function ProviderSetupCard({
  providers,
  onAddKey,
}: {
  readonly providers: readonly ProviderSetup[];
  readonly onAddKey: (providerId: string, key: string) => Promise<void>;
}): React.ReactElement | null {
  const keyed = providers.filter((provider) => provider.methods.includes("api_key"));
  const oauthOnly = providers.filter(
    (provider) => !provider.methods.includes("api_key") && provider.methods.includes("oauth"),
  );
  const [providerId, setProviderId] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const keyRef = React.useRef<HTMLInputElement>(null);

  if (providers.length === 0) return null;
  const selected = providerId.length > 0 ? providerId : (keyed[0]?.id ?? "");

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const key = keyRef.current?.value.trim() ?? "";
    if (selected.length === 0 || key.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    onAddKey(selected, key).then(
      () => {
        setSaving(false);
        if (keyRef.current !== null) keyRef.current.value = "";
      },
      (cause: unknown) => {
        setSaving(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  };

  return (
    <div {...stylex.props(styles.root)}>
      <Text size="sm" weight="semibold">
        Add a provider
      </Text>
      {keyed.length > 0 && (
        <form {...stylex.props(styles.row)} onSubmit={submit}>
          <select
            {...stylex.props(styles.select)}
            value={selected}
            aria-label="Provider"
            onChange={(event) => setProviderId(event.target.value)}
          >
            {keyed.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          <div {...stylex.props(styles.grow)}>
            <Field>
              <Field.Input
                ref={keyRef}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="API key…"
                aria-label="API key"
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </form>
      )}
      {error !== null && <div {...stylex.props(styles.errorText)}>{error}</div>}
      {oauthOnly.length > 0 && (
        <div {...stylex.props(styles.hint)}>
          {oauthOnly.map((provider) => (
            <div key={provider.id}>
              {provider.id}: pnpm --filter @honk/core cli login {provider.id}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
