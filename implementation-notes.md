# Implementation Notes

Running notes for the provider rewrite toward the canonical supported list:
Codex/OpenAI, Claude, OpenCode, Cursor, and Pi pending only.

## Decisions

- Use `pi` as the pending Pi driver key. It remains UI-only pending until a
  provider contract and adapter exist.
- Keep the existing `claudeAgent` driver key for Claude because it is already a
  persisted supported key in contracts, settings, and sessions.
- Keep the existing `cursor` driver key as canonical. Cursor was not supposed
  to be removed; the current requirement makes Cursor one of the supported
  providers and one of the two ACP-focused providers.
- Keep Cursor ACP capability discovery in place. Cursor needs the
  parameterized model picker client capability during initialize, and Multi's
  model picker should consume Cursor's discovered config options instead of
  inventing separate UI policy.
- Treat Cursor model capabilities as live ACP facts. `null` means "not probed
  yet"; an empty descriptor list means "probed and no options." The provider
  registry must not copy stale option descriptors onto refreshed Cursor models,
  because that can re-enable unsupported thinking/reasoning controls.
- Preserve Cursor ACP model-selection failure context. Base model failures are
  surfaced as `session/set_model`; option update failures are surfaced as
  `session/set_config_option`, so logs and UI errors do not mislabel the broken
  step.
- Do not trust Cursor ACP config echoes as the source of truth immediately
  after a successful config write. A provider log showed Cursor accepting
  `model=composer-2.5` while the response still reported
  `currentValue=kimi-k2.5`; Multi now records the requested value locally so it
  does not resend the same accepted model update on every turn. The refreshed
  `t3code` mirror still trusts the ACP response directly, so Multi intentionally
  diverges here based on the captured Cursor behavior.
- Keep `packages/contracts/src/model.ts` schema-only. Provider model catalogs,
  aliases, and per-provider defaults must not live in contracts because Cursor
  can add models such as Composer 2.5 through its own model/config discovery
  without a Multi contract release.

## Tradeoffs

- Pi is represented as pending in settings/model picker UI only. It is not
  registered in server provider or adapter lists, so session routing still
  fails clearly if someone manually persists a `pi` instance.
- Cursor remains a built-in provider despite being ACP-backed. The unsupported
  pending affordance is only for Pi.
- Removing contract-level model aliases means shorthand inputs such as `sonnet`
  are no longer canonical unless the provider catalog itself exposes that name.
  This keeps user selection resolution tied to live provider facts.

## Changes To Watch

- Existing dirty work unrelated to the provider rewrite remains untouched.
- `scripts/oxlint-plugin-multi.js` had prior in-progress changes before this
  provider rewrite and still needs its own verification later.
- Noncanonical coming-soon providers such as Gemini, GitHub Copilot, and ACP
  Registry should be removed from the active settings/picker surfaces. Pi is
  the only pending placeholder in the canonical list.
- The app Vite shared config split must keep `packages/app/vite.shared.ts`
  inside the app tsconfig include list, and helper return types must be
  concrete rather than `UserConfig[...] | undefined` because the repo enables
  `exactOptionalPropertyTypes`.
