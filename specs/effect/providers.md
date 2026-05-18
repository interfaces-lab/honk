# Provider Foundations

This spec defines the provider surface Multi supports in this unreleased line.
Provider support is canonical only when contracts, server registries, adapters,
runtime discovery, settings, and picker UI all agree on the same driver list.
ACP support is intentionally narrow: Amp and Cursor are the only ACP-first
providers in this foundation.

## Canonical Providers

- [x] Codex/OpenAI: supported through the Codex app-server provider and adapter.
- [x] Claude: supported through the Claude provider and adapter.
- [~] Amp: supported through `amp-acp` over ACP stdio.
- [x] OpenCode: supported through the OpenCode server/SDK provider and adapter.
- [~] Cursor: supported through Cursor Agent ACP over stdio.
- [ ] Pi: visible only as an unsupported pending provider. It must not route
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
- [~] `amp`
- [x] `opencode`
- [~] `cursor`
- [ ] `pi` as pending only

Driver keys are persisted identifiers. UI labels may say `Claude`, `Amp`, or
`Pi`, but server routing uses the exact driver key above.

## Amp ACP Contract

Research source: `codebase update amp-acp` and
`~/.agents/codebases/amp-acp`.

- [x] Binary: `amp-acp`.
- [x] Transport: ACP JSON-RPC over stdio.
- [x] Auth method: `setup`; the adapter accepts `AMP_API_KEY` from provider
      settings/env or the `amp-acp` credentials file.
- [x] Setup: `amp-acp --setup` stores an API key under the user config dir.
- [x] Sessions: `newSession` returns `default` and `bypass` modes.
- [x] Prompt: text and image prompt parts are accepted; `/init` is translated by
      `amp-acp` into AGENTS.md generation instructions.
- [x] Model switching: `setSessionModel` is a no-op. Multi exposes one logical
      model, `amp`.
- [x] Events: assistant text, thinking, tool calls, tool results, and available
      command updates are emitted as ACP session updates.

## Cursor ACP Contract

- [x] Binary: Cursor Agent CLI, default command `agent acp`.
- [x] Transport: ACP JSON-RPC over stdio.
- [x] Auth method: `cursor_login`.
- [x] Client capability: parameterized model picker metadata must be sent during
      initialize so Cursor can expose model/config options.
- [x] Sessions: mode/config state comes from ACP setup responses and updates.
- [x] Model switching: set the base model through ACP and apply model option
      config updates.
- [x] Extension events: Cursor plan/todo/question extension messages are mapped
      into Multi plan and pending-user-input events.

## Done Means

- [ ] `packages/contracts` exposes Amp settings and model capability schema
      without provider-specific model defaults.
- [ ] `packages/server` has Amp provider status, adapter routing, runtime
      wiring, and text-generation routing.
- [ ] Built-in server registries include only Codex/OpenAI, Claude, Amp,
      OpenCode, and Cursor.
- [ ] Renderer provider settings and model picker include only supported
      providers plus Pi pending.
- [ ] Typecheck passes after the provider rewrite.
