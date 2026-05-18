# Implementation Notes

Running notes for the provider rewrite toward the canonical supported list:
Codex/OpenAI, Claude, Amp, OpenCode, Cursor, and Pi pending only.

## Decisions

- Use `amp` as the persisted Amp driver key. The user-facing label is `Amp`.
- Use `pi` as the pending Pi driver key. It remains UI-only pending until a
  provider contract and adapter exist.
- Keep the existing `claudeAgent` driver key for Claude because it is already a
  persisted supported key in contracts, settings, and sessions.
- Keep the existing `cursor` driver key as canonical. Cursor was not supposed
  to be removed; the current requirement makes Cursor one of the supported
  providers and one of the two ACP-focused providers.
- Add Amp as one logical model, `amp`, because `amp-acp` implements
  `setSessionModel` as a no-op and delegates model choice to Amp.
- Treat Amp auth as `setup`: `amp-acp` accepts `AMP_API_KEY`, loads its stored
  credentials file, and exposes `amp-acp --setup` through ACP terminal auth.
- Keep Cursor ACP capability discovery in place. Cursor needs the
  parameterized model picker client capability during initialize, and Multi's
  model picker should consume Cursor's discovered config options instead of
  inventing separate UI policy.
- Keep `packages/contracts/src/model.ts` schema-only. Provider model catalogs,
  aliases, and per-provider defaults must not live in contracts because Cursor
  can add models such as Composer 2.5 through its own model/config discovery
  without a Multi contract release.
- Use `codebase update amp-acp` before changing Amp behavior. The refreshed
  `amp-acp` package is version `0.7.0`, exposes `amp-acp`, authenticates via
  `setup`, and returns `default`/`bypass` modes.

## Tradeoffs

- Amp status probing starts an ACP session instead of running `amp-acp --version`
  because `amp-acp` has no documented version CLI in the mirrored repo.
- Amp text generation is ACP-based and denies permission requests. This keeps
  git title/branch/commit generation read-only from Multi's side.
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
