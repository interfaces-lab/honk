---
name: honk-ui
description: Build and evolve @honk/ui as one platform-resolved web, iOS, and Android component system
---

# Honk UI

Use this skill for changes to `packages/ui`, for new shared UI primitives, and for any web/native
component work.

## Load the contract

1. Read `packages/ui/AGENTS.md` completely.
2. Load the local `design` skill for product judgment and request-mode routing.
3. Read `.design/README.md`, then the required principles and exemplar for the component family.
4. For web, read the StyleX and styling-token skills completely.
5. For native, load the relevant Expo/native skill and verify installed dependency types.

## Choose the boundary before writing code

- Keep one logical public component API.
- Put renderer-neutral props, state transitions, accessibility intent, and pure behavior in shared
  modules.
- Use `.web.tsx` for DOM/StyleX and `.native.tsx` for React Native/Expo when rendering or interaction
  differs. Use `.ios.tsx` or `.android.tsx` only when the native implementation cannot stay shared.
- Import the unsuffixed path. Never use dynamic imports, conditional `require()`, or runtime
  web/native branching to select an implementation.
- Do not add a native placeholder. A platform is supported only when a real consumer resolves,
  typechecks, and exercises it.

## Learn native behavior from source

For a native primitive, inspect the current `bluesky-social/social-app` implementation before
designing Honk's renderer. Read the complete component and its platform variants at a recorded commit.
Use Bluesky to learn interaction mechanics and footguns, then reconcile them with current Expo/React
Native types and Honk's product rules.

Required starting points:

- Field/TextField: `src/components/forms/TextField.tsx`
- Dialog: `src/components/Dialog/index.tsx` plus `index.web.tsx`
- Menu: `src/components/Menu/index.tsx` plus `index.web.tsx`
- Button: `src/components/Button.tsx`
- Typography: `src/components/Typography.tsx`

Do not copy Bluesky's palette, icons, component names, or legacy workarounds blindly.

## Renderer rules

**Web:** DOM semantics, Base UI where established, StyleX primitives, generated
`platform-tokens.stylex.ts` values for cross-platform components, `tokens.stylex.ts` for remaining
web-only values, token-backed Tailwind for layout, and plain CSS only for substrate escapes.

**Native:** React Native and Expo primitives, native focus/keyboard/gesture/accessibility behavior,
no CSS/Tailwind/DOM/Base UI/StyleX output, and `central-icons` unless the project explicitly changes
its icon system.

The semantic theme vocabulary is shared through `@honk/ui/theme`. CSS functions are a web
representation; native values come from the same source, not from a second palette.

## TextField gate

Treat TextField as the first proof of the architecture. Before calling it native-ready, verify
uncontrolled and controlled input, multiline metrics, autofill, keyboard and submit behavior,
secure entry, refs, focus/error chrome, font scaling, accessibility labels, and use inside a sheet.
Do not expose a shared prop type formed by combining DOM input props with React Native
`TextInputProps`; define a product-level contract and narrow renderer-specific extensions.

## Finish

- Run `pnpm run check:mobile` for supported Expo dependency, platform-resolution, shared SDK, and
  affected-consumer checks.
- Run `node .design/lint.mjs` for web UI.
- Exercise native changes on both iOS and Android once the mobile consumer exists.
- Report which platforms were actually verified and never imply untested parity.
