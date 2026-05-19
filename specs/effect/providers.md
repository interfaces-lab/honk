# Provider Foundations

This spec defines the provider surface Multi supports in this unreleased line.
Provider support is canonical only when contracts, server registries, adapters,
runtime discovery, settings, and picker UI all agree on the same driver list.
ACP support is intentionally narrow: Cursor is the ACP-first provider in this
foundation.

## Canonical Providers

- [x] Codex/OpenAI: supported through the Codex app-server provider and adapter.
- [x] Claude: supported through the Claude provider and adapter.
- [x] OpenCode: supported through the OpenCode server/SDK provider and adapter.
- [x] Cursor: supported through Cursor Agent ACP over stdio.
- [x] Pi: visible only as an unsupported pending provider. It must not route
      sessions until a real provider contract and adapter exist.

No other hosted provider, ACP registry provider, or placeholder provider should
appear in settings, picker rails, or built-in server registries.

## Model Catalog Ownership

- [x] `packages/contracts/src/model.ts` defines provider option and capability
      schema only. It must not hardcode provider model catalogs, provider model
      aliases, or per-provider model defaults.
- [x] Live provider model lists come from provider snapshots, ACP discovery, or
      provider-owned settings. Cursor model additions such as Composer 2.5 must
      be accepted through discovery without editing contract constants.
- [x] Model input normalization trims user input and resolves exact slug/display
      matches from the live selectable catalog. Provider-specific shorthand
      aliases are not canonical unless the provider reports them.

## Driver Keys

- [x] `codex`
- [x] `claudeAgent`
- [x] `opencode`
- [x] `cursor`
- [x] `pi` as pending only

Driver keys are persisted identifiers. UI labels may say `Claude` or `Pi`, but
server routing uses the exact driver key above.

## Cursor ACP Contract

- [x] Binary: Cursor Agent CLI, default command `agent acp`.
- [x] Transport: ACP JSON-RPC over stdio.
- [x] Auth method: `cursor_login`.
- [x] Client capability: parameterized model picker metadata must be sent during
      initialize so Cursor can expose model/config options.
- [x] Sessions: mode/config state comes from ACP setup responses and updates.
- [x] Model switching: set the base model through ACP and apply model option
      config updates.
- [x] Model option capabilities: `null` capabilities mean a Cursor model has
      not been probed yet; an empty descriptor list means Cursor exposed no
      supported options for that model.
- [x] Cursor thinking/reasoning controls are shown and sent only when the
      selected model's current ACP config options expose the matching option.
      Refreshed empty capabilities must not inherit stale descriptors from a
      previous provider snapshot.
- [x] Cursor model-selection errors preserve the failed step:
      `session/set_model` for base model selection and
      `session/set_config_option` for model option updates.
- [x] After a successful `session/set_config_option`, Multi records the
      requested value as the local current value. Cursor can echo stale
      `configOptions.currentValue` in the response even after accepting the
      write, and Multi must not repeatedly resend the same model/config update.
- [x] Extension events: Cursor plan/todo/question extension messages are mapped
      into Multi plan and pending-user-input events.

## Done Means

- [x] `packages/contracts` exposes model capability schema without
      provider-specific model defaults.
- [x] Built-in server registries include only Codex/OpenAI, Claude, OpenCode,
      and Cursor.
- [x] Renderer provider settings and model picker include only supported
      providers plus Pi pending.
- [x] Typecheck passes after the provider rewrite.
