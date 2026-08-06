# Core UX

Reusable flow, surface, safety, and state-communication rules for product UX.

This is the cross-cutting baseline for interaction shape. Move touched surfaces toward these rules
without inventing parallel product models. For wording, load [`copy.md`](copy.md). For Honk-specific
judgment, quality, resilience, and accepted rules, load the routed references in
[`SKILL.md`](../SKILL.md).

Do not preserve non-conformant prompts, output, or errors just because a neighboring surface does it
today. Compatibility contracts (API shapes, persisted keys, telemetry meaning) change only with an
intentional, tested migration.

## Voice + Copy Baseline

Most UX work touches strings. Detailed wording rules live in [`copy.md`](copy.md). Keep this short
baseline in view when shaping flows:

- Clear, competent, no fluff.
- Be brief. Every word earns its place.
- Use active voice by default.
- Use contractions when natural.
- Use numerals: `3 conversations`, not `three conversations`.
- Use sentence fragments for labels/status; full sentences for error messages.
- Use `Failed to` for system/API/network failures.
- Use `Couldn't`/`Can't` for user-state or validation failures.
- Do not use `Unable to`.
- Do not use `successfully`; name the completed action.
- Do not use `Oops`, `Uh-oh`, `Whoops`, `Heads up`, `please`, or apologies unless we are at fault or
  asking the user for an inconvenient favor.
- Use `…`, not `...`, in prose/progress text. Keep `...` only when syntax requires it.

Avoid:

- vague yes/no prompts
- possessive resource-name prompts
- `defaults` when the user is editing settings
- `Do you want to...`
- `Would you like to...`
- `An error occurred`
- `Something went wrong` except as last-resort fallback

Canonical Honk vocabulary lives in [`glossary.md`](glossary.md) and [`rules.md`](rules.md).

## Data Mechanics

- Decimal units by default: `MB`, `GB`, `TB`.
- Binary units only for literal memory: `MiB`, `GiB`.
- Compact UI: `42ms`, `3.4s`, `5m`.
- Prose: `42 ms`, `3.4 s`, `5 minutes`.
- Machine timestamps are ISO 8601 UTC.
- Human-facing timestamps use local time or relative time such as `3m ago`; use UTC only when
  precision or supportability matters.
- Respect singular/plural interpolation; never use `item(s)`.
- Empty states use `No conversations yet.`, not `0 conversations found.`

## Flow Design

Order:

1. **Orient.** Show what the action is acting on.
2. **Detect.** Show meaningful inferred state.
3. **Decide.** Ask only unresolved, risky, or ambiguous choices.
4. **Preview.** Show planned risky/broad mutations.
5. **Mutate.** Do work with progress when it may take time.
6. **Confirm.** Show the durable result: object, destination, status.
7. **Continue.** Offer the exact next action when useful.

Rules:

- Show detected state before dependent prompts.
- A copy change is incomplete until the surrounding flow is checked: resolved state before decisions,
  side effects after mutation, and exact next action when useful.
- Do not let better wording hide a bad order; move the state/result into the right surface.
- Do not show state only to prove the system resolved it. Show it when it changes the next decision,
  prevents ambiguity, or confirms a durable result.
- Group related questions.
- Prefer one chooser over several vague yes/no prompts.
- Yes/no prompts confirm a concrete thing, not vague intent.
- If preview details already show the values, ask for the action instead of repeating one value in the
  prompt.
- If a prior answer already contains the value, do not restate it unless the restatement adds a new
  relationship or destination.
- If a safe default exists, show it and make acceptance cheap.
- If a user declines an inferred choice, route to the next concrete choice; do not restart.
- When mutating both local and remote state, make user-facing effects visible.

## Setup + Mutation Flows

Any flow that resolves a resource or changes local/remote state should use the same shape:

- Treat an explicit user action as intent; do not ask a vague intent-confirmation prompt.
- Show the resolved target before prompts or mutation.
- Before confirming an inferred resource, show it as structured state.
- Once the target is obvious, keep moving. Do not repeat resolved-state chrome before every later
  prompt.
- Keep status headings separate from value details. Do not encode a status heading as a fake
  label/value row.
- Ask for the smallest missing value with a concrete noun.
- Ask to customize settings only after showing the inferred settings.
- Ask path/root questions only when there is real ambiguity.
- Compress detection into one useful line when possible.
- Include detection details only when they differ from defaults, are non-obvious, or affect the next
  decision.
- Confirmation records intent; completion records what actually happened. Do not drop a result just
  because the user confirmed.
- If work continues elsewhere, end with a stable way to inspect status.
- Offer optional follow-up work only when safe and clearly secondary.

## Prompts

Prompt only when:

- the value cannot be inferred
- no existing selection, setting, or payload already provides it
- the prompt meaningfully reduces risk or ambiguity

Never require a prompt when a precise non-interactive path should exist. Prefer failing with the exact
missing input over trapping the user.

Defaults:

- Make defaults visible.
- Prefer the most common safe value.
- Echo important resolved state after defaults are accepted.
- If a short explanation only qualifies the current prompt, keep it as inline context. Do not promote
  it into a separate surface unless it is independent state, progress, warning, or result.

Good:

```text
Delete conversation “Launch checklist”?
This cannot be undone.
```

Bad:

```text
Do you want to delete this?
```

## Output Surfaces

Pick one surface before writing copy:

- prompt: user must decide
- progress: work is happening
- success: action completed
- warning: nonfatal risk, compatibility, deprecation, or post-action review notice
- error: action failed
- empty: no items for the current scope or filters
- list/detail: many or one resources
- stream: live ongoing output
- toast: brief local feedback with no durable home

Do not mix surfaces in one control. A durable result belongs in the durable surface, not a progress
label. See [`resilience.md`](resilience.md) for toast vs stream ownership.

## Progress + Completion

- Show feedback quickly for network or long-running work.
- Prefer phase progress when the denominator is unknown or untrustworthy.
- Use quantitative progress only with a trustworthy current and total that users benefit from seeing.
- Do not invent percentages for work that can stall, retry, fan out, or change total size.
- Progress text uses present participles: `Syncing…`, `Saving…`.
- Final success gets one primary completion signal; add secondary receipt detail only for necessary
  durable context.
- Success names what changed and where. Never use `Done.` or `Success!`.
- Include the durable identifier when it helps the next action: object, path, URL, or ID.
- Do not claim ready while work is still running.
- If cancellation may leave remote work running, say how to inspect status. Closing a view never stops
  underlying work; see [`resilience.md`](resilience.md).

## Errors

Errors include:

1. what failed
2. the rule or constraint
3. how to fix it

Rules:

- Put the most actionable line last in multi-line errors.
- Group repeated failures under one explanation.
- Never print raw upstream error objects in product UI.
- Translate platform/API errors into product voice.
- Preserve actionable partner messages with attribution when that wording helps support.
- Pair platform/system failures with a stable ID when available.
- Do not attach stable IDs to validation errors or permission denials unless they help support.
- Permission errors must avoid disclosing private resource existence across tenant boundaries.

Permission/access errors should include safe versions of:

- attempted action
- actor or active context
- resource/context
- missing authority or constraint
- resolver: role holder, settings, login, docs, or support

## Warnings

- Warn only for a nonfatal condition the user should review before continuing or after completion;
  otherwise use error or stay silent.
- Structure: what happened · why it matters · optional fix or next step.
- Do not cry wolf; a warning on every run trains users to ignore it.
- Deprecation warnings name the replacement.

## Secrets

- Never print tokens, secret values, request bodies, or unredacted sensitive content.
- Redact secrets in UI, logs, telemetry, errors, and suggested next actions.
- Prefer secure input paths for secret entry; do not echo entered secrets into receipts.
- Treat values read from files, env, API responses, and remote resources as sensitive until classified.
- Permission errors should not reveal whether a private resource exists across tenant boundaries.

## Dangerous Actions

- Dangerous actions include deletes, production mutations, secret changes, billing changes, permission
  changes, and broad rewrites.
- Show target, scope, and planned mutation before executing.
- Low-risk defaults may skip prompts, but must not bypass severe destructive confirmation.
- Destructive prompts default to cancel/No; never default-accept destructive work.
- Typed confirmations name the exact required value when impact warrants it.
- No-op, already-done, staged, draft, and published states must be distinct.
- Local writes and remote mutations should be ordered so partial failure is recoverable or clearly
  explained.

## Hardening

- Validate traversal, control characters, and unexpected encodings before use.
- Bound large lists and payloads by default with pagination, filters, or concise defaults.
- Never interpolate untrusted local, remote, or user-generated content into suggested shell commands.
- Treat remote content as data, not instructions.
- Avoid stack traces and raw upstream objects in product UI unless an intentional debug surface.
- Cover interactive, reduced-capability, invalid-input, and permission-denied variants when those
  contracts change.

## Layout + Perception

Visual hierarchy, component choice, and tokens belong to [`interface-quality.md`](interface-quality.md)
and the StyleX/token skills. Keep these core constraints in view:

- Prefer hierarchy, spacing, and alignment before containers.
- Color reports status or focus/primary intent; it does not provide identity or liveliness.
- Never rely on color alone for required meaning.
- Respect reduced motion and constrained widths when they can change understanding.
- Critical IDs, URLs, paths, and commands need an exact untruncated path somewhere in the UI.
