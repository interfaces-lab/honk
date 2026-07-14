---
name: design
description: >-
  Single entry point for Honk product design and user-facing implementation. Use when work changes what a
  user sees, understands, chooses, or does: shaping flows; building or redesigning UI; reviewing
  screenshots or diffs; improving copy, hierarchy, interaction, accessibility, responsive behavior,
  or loading, empty, error, permission, and destructive states.
---

# Product Design

Make the interface correct for the user and the product. Working code is insufficient when the
interaction, consequence, reachable states, or rendered result is wrong.

This workflow follows Vercel's product-design model: accepted judgment stays in explicit guidance,
mechanical rules move into linters, and exemplars preserve decisions worth repeating. Source:
[Teaching agents product design at Vercel](https://vercel.com/blog/teaching-agents-product-design-at-vercel).

## Operating contract

- Start with the user's job and desired outcome before choosing a surface or component.
- Use repository guidance and verified behavior as evidence. Shipped code proves what exists, not why
  it is correct.
- Separate facts, assumptions, and unresolved product choices.
- Resolve information architecture, semantics, interaction, and reachable states before decoration.
- Choose the smallest coherent intervention and preserve existing context unless changing it solves
  the stated problem.
- Verify the rendered surface. Source inspection alone does not establish visual or interaction
  quality.

## Resolve the request mode

- **Shape:** Define the problem, alternatives, flow, states, acceptance criteria, risks, and open
  decisions. Do not edit unless asked.
- **Implement:** Resolve product decisions, then build the smallest coherent end-to-end change in
  scope.
- **Review:** Inspect source and rendered evidence, then report prioritized findings. Do not edit
  unless asked.
- **Copy:** Change user-facing language, accessible names, and directly required markup without
  silently expanding into a redesign.
- **Harden:** Preserve the settled direction while fixing state, resilience, responsive,
  accessibility, and finish defects.

When intent is ambiguous, use the narrowest mode supported by the user's verb. A URL, screenshot,
route, or component identifies scope but does not authorize unrelated edits.

## Load product context

1. Read the applicable `AGENTS.md` chain and the product logic that determines mutations,
   permissions, validation, errors, and side effects.
2. Read [Honk Design](../../../.design/README.md), then load the applicable principles and exemplars
   it names. These Honk-specific decisions override generic guidance.
3. Load component, platform, styling, accessibility, and copy skills only for the current surface.

## Design and implement

For material changes, identify the user, job, current behavior, desired outcome, success signal,
non-goals, product object, scope, action, consequence, reversibility, permissions, and open decisions.
Map entry points, visible regions, overlays, transitions, exits, and return paths, then cover every
reachable loading, empty, sparse, populated, validation, error, permission, disabled, optimistic,
stale, destructive, and responsive state that the product can actually enter.

For each non-mechanical change, be able to explain the user problem, why the chosen component fits,
what consequence the interface communicates, which evidence supports the decision, and why the
change is the smallest coherent one.

## Verify

1. Confirm the primary job and acceptance criteria.
2. Run repository design lint and relevant typechecks.
3. Inspect compact and wide viewports on the real rendered surface.
4. Exercise every materially changed reachable state.
5. Verify keyboard order, focus movement, pointer and touch targets, loading behavior, long content,
   constrained width, and localization risk.
6. State exactly what was rendered and exercised; never imply visual verification from code review.

## Skill integrity

- Add a product rule only after current-source verification and human acceptance.
- Record its scope, rationale, evidence, exceptions, and a bad and good example.
- Keep deterministic checks mechanical and keep judgment in prose with its evidence.
- Never promote one screenshot, shipped file, or reviewer comment into a universal rule by itself.
