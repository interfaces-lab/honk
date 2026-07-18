---
name: product-design
description: >-
  Single entry point for Honk product design and user-facing implementation. Use whenever work changes
  what a user sees, understands, chooses, or does: shaping requirements and flows; building or
  redesigning screens and components; reviewing URLs, screenshots, diffs, or findings; improving copy,
  information architecture, component choice, hierarchy, layout, interaction, accessibility,
  responsive behavior, and loading, empty, error, permission, offline, or destructive states. Trigger
  on design, UX, UI, usability, flow, onboarding, settings, build, improve, fix, audit, review, polish,
  simplify, or production-ready requests. Also use when backend behavior changes a user-visible
  outcome. Not for backend-only work with no user-visible effect, tests with no shipped UI impact,
  telemetry-only work, generated files, documentation, or marketing content.
---

# Honk Product Design

Make the interface correct for the user and Honk. Working code is not enough: choose the right
interaction, make scope and consequences clear, cover reality beyond the happy path, and verify the
rendered result.

## Operating Contract

- **Start with the job, not the pixels.** Identify who is acting, what they are trying to accomplish,
  the product object involved, and what the system will change.
- **Define the outcome before the output.** Establish the current user problem, desired behavior,
  success signal, and non-goals before choosing a surface or component.
- **Use evidence, not taste.** Trace decisions to product behavior, canonical repository guidance, an
  accepted product-design decision, or a verified adjacent pattern.
- **Separate facts from decisions.** Mark assumptions and unresolved product choices explicitly; do
  not hide them inside implementation details.
- **Treat shipped code as evidence, not automatic precedent.** It proves what exists, not why it is
  correct. Check it against current components, product behavior, and explicit guidance.
- **Choose the smallest coherent intervention.** Consider better defaults, behavior, or reuse before
  adding UI. Do not solve one job by creating unrelated settings or abstractions.
- **Decide before decorating.** Resolve information architecture, component semantics, interaction,
  and state behavior before styling or rewriting copy.
- **Design every reachable state.** Include only states the product can actually enter, but do not stop
  at the populated success case.
- **Verify the real surface.** Source inspection establishes behavior; a rendered interface establishes
  visual and interaction quality. Never claim visual verification from code alone.
- **Keep one user-facing entry point.** Invoke `product-design`; route internally to canonical sources.

## Request Modes

Resolve the mode from the user's verb and artifact before acting.

| Mode      | Typical request                                                            | Required behavior                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | “Design this flow,” “How should this work?”, or a brief without settled UI | Frame the problem and evidence, compare material alternatives, then define the flow, states, acceptance criteria, risks, and open decisions. Do not edit unless asked. |
| Implement | “Build,” “fix,” “improve,” “make compliant,” or “run product-design”       | Resolve material product decisions, then implement the smallest coherent end-to-end change in scope. Do not absorb unrelated review findings.                          |
| Review    | “Audit,” “critique,” “what’s wrong?”, screenshot review, or code review    | Inspect source and rendered evidence, then report prioritized findings. Do not edit unless asked.                                                                      |
| Copy      | “Fix the copy” or “rewrite these errors”                                   | Edit user-facing language, accessible names, and directly required markup only. Report structural blockers without silently broadening scope.                          |
| Harden    | “Polish,” “production-ready,” or “handle edge cases”                       | Preserve the settled product direction while fixing state, resilience, responsive, accessibility, and finish defects.                                                  |

When intent is ambiguous, use the narrowest mode supported by the verb. A URL, screenshot, route, or
component identifies scope; it does not authorize unrelated edits.

A material decision changes the user's task, default, scope, consequence, navigation, interaction
surface, or reachable states. Copy mechanics, token replacement, and established component
substitutions usually are not material.

## Decision Authority

Resolve conflicts in this order:

1. The user's explicit goal and constraints.
2. Verified user and product evidence and system truth.
3. Repository-canonical guidance: the applicable `AGENTS.md` chain, `packages/ui` contracts, and routed
   implementation skills.
4. Accepted decisions in `references/rules.md` and exemplars with stable evidence.
5. Verified adjacent shipped patterns in the same product area.
6. General interface heuristics.

## Workflow

### 1. Set scope and mode

Name the target surface and request mode in the work plan or review notes.

### 2. Load product context

Read the applicable `AGENTS.md` chain, supplied briefs and designs, and the product logic that
determines mutations, permissions, validation, errors, and side effects.

### 3. Model the product decision

For Shape, Implement, Harden, full Review, or any material product or flow change, read
`references/product-judgment.md` and write a compact internal brief covering:

- user and job
- current behavior and desired outcome
- success signal and non-goals
- product object and scope
- action and consequence
- reversibility and permissions
- assumptions and open decisions

### 4. Map the surface and states

Inventory entry points, visible regions, overlays, transitions, exits, and return paths. Map only
reachable loading, empty, sparse, populated, validation, error, permission, disabled, optimistic,
stale, destructive, offline, compact, and wide states that apply.

### 5. Load routed references

Always read this directory's `AGENTS.md`, `references/product-judgment.md`, and
`references/rules.md`. Then route narrowly:

| Need                                                                             | Load                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Product, flow, or component decision                                             | `references/product-judgment.md` + `references/surfaces.md`                       |
| Implementation, material visual change, or full review                           | `references/interface-quality.md`                                                 |
| Copy or accessible names                                                         | `references/copy.md` + `references/glossary.md` + applicable surface reference    |
| Overflow, localization, extreme data, network, error, stale, or offline behavior | `references/resilience.md`                                                        |
| Honk interaction or component pattern                                            | `references/patterns.md` + the focused file under `exemplars/`                    |
| Web layout, typography, color, spacing, or StyleX                                | `.agents/skills/stylex/SKILL.md` + `.agents/skills/styling-tokens/SKILL.md`       |
| Shared component or native contract                                              | `packages/ui/AGENTS.md` + the applicable installed platform skill                 |
| Uncovered product decision                                                       | `references/coverage-gaps.md`; do not infer a standard from a neighboring surface |

Read exemplars last, after understanding the product decision. They are evidence, not templates.

### 6. Decide, then implement

For every non-mechanical change, be able to answer:

- What user problem does this solve?
- Why is this component or interaction appropriate?
- What object, scope, and consequence must the interface communicate?
- Which evidence supports the decision?
- Why is this the smallest coherent change?

### 7. Verify

1. Confirm the primary job and acceptance criteria.
2. Run `pnpm run lint:design` and the narrow package checks required by the applicable `AGENTS.md`.
3. Inspect relevant compact and wide viewports on the real rendered surface.
4. Exercise every materially changed reachable state.
5. Verify keyboard order, focus movement, loading behavior, and pointer or touch targets.
6. Test long content, large values, constrained width, reduced motion, and localization or RTL risk.
7. State exactly what was rendered and exercised; do not imply visual verification from source review.

## Product Design Standards

- Make the user's primary task and primary action unmistakable.
- Preserve the user's mental model and current context unless changing it solves a verified problem.
- Name the exact object, scope, and consequence of important actions.
- Use navigation components for navigation and action components for actions.
- Choose surface persistence to match importance.
- Prefer inline disclosure before adding a modal.
- Expose advanced controls when needed without making the default path carry their complexity.
- Prefer strong defaults and direct behavior over configuration the user must learn and maintain.
- Use semantic `@honk/ui` components and their APIs before custom controls or styling.
- Use hierarchy, spacing, and alignment before adding containers.
- Preserve user input through validation and recoverable errors.
- Keep loading control labels stable and use the component's loading or busy affordance.
- Make destructive actions proportional to impact and provide undo only when the system honestly can.
- Do not add decorative novelty, motion, or copy unless it clarifies structure, state, or brand intent.

Honk-specific standards such as status vocabulary, conversation hierarchy, queue behavior, and shell
anatomy live in `references/rules.md`; do not duplicate or dilute them here.

## Review Output

Lead with findings ordered by user impact:

- **P0:** blocks the primary task, creates a severe accessibility failure, or can cause unrecoverable
  user harm.
- **P1:** likely task failure, misleading consequence, missing critical state, or major responsive or
  accessibility defect.
- **P2:** meaningful friction, inconsistency, weak hierarchy, or recoverability issue.
- **P3:** minor craft or consistency improvement.

For each finding include the file and line or rendered location, verification status, canonical source,
user consequence, and smallest concrete fix. Do not pad a review with low-confidence findings.

## Skill Integrity

- Add or change a rule only after current-source verification and human acceptance.
- Record status, scope, rule, rationale, evidence, accepted decision source, exceptions, and a bad and
  good example.
- Prefer the narrowest destination: canonical source, routed reference, exemplar, lint or eval check,
  or coverage gap.
- Keep deterministic checks mechanical. Keep judgment in prose with its evidence and degree of
  freedom.
- Never promote one screenshot, shipped file, or reviewer comment into a universal rule by itself.
