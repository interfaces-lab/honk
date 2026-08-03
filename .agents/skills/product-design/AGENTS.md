# Product-design governance

## Load order

Follow `SKILL.md` routing. Load the core judgment and rules first, then only applicable surface and
quality references. Read exemplars last, after the product decision is understood.

## Evidence and rules

- Use explicit repository guidance, verified behavior, or accepted decisions as evidence. Distinguish
  facts, inferences, and open questions.
- Shipped code is evidence, not automatic precedent. One file, screenshot, or reviewer comment cannot
  establish a universal rule.
- New or changed standards require current-source verification and human acceptance. Give every rule a
  stable `rule/...` ID, scope, rule, rationale/source, and relevant exceptions and examples.
- Put a decision in the narrowest owner: canonical component/platform docs, a focused reference,
  exemplar, deterministic lint, eval fixture, or coverage gap. Never invent guidance to fill a gap.
- Keep mechanical, low-false-positive checks in tooling. Keep contextual judgment in prose.

## Validation

Run `pnpm run lint:design` after user-visible code or deterministic-rule changes. Validate links and
paths when changing this skill. Eval fixtures are human-reviewed datasets, not executable tests and not
proof that a rule is accepted.
