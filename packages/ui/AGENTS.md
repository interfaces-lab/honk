# @honk/ui agent rules

`@honk/ui` is one design-system API with platform-resolved renderers. Web, iOS, and Android expose
the same product capabilities and semantic component contracts; their markup, interaction
primitives, and presentation may differ when the platform requires it.

Native support is incremental: the Expo consumer exercises the platform-resolved TextField, but the
rest of the package remains web-only until each component gains a real native renderer. Never imply
package-wide native parity from one proof component, and do not add placeholder native files or
unused React Native dependencies.

## Required reading

- Read the repository `AGENTS.md`, `.agents/skills/design/SKILL.md`, `.design/README.md`, and
  `.agents/skills/honk-ui/SKILL.md` first.
- For web implementation, also read the StyleX and styling-token skills completely.
- For native implementation, use the installed Expo/native-UI skills and verify APIs against the
  consumer's installed Expo and React Native versions.

## One API, platform-resolved implementations

Import a component through its unsuffixed public path. Never import a `.web`, `.native`, `.ios`, or
`.android` file directly, and never choose an implementation with `require()`, dynamic `import()`,
or a runtime web/native conditional.

Use the same resolver convention as React Native and Bluesky:

```text
component/index.tsx          shared implementation when it is genuinely renderer-neutral
component/index.web.tsx      DOM + StyleX implementation
component/index.native.tsx   shared iOS + Android implementation
component/index.ios.tsx      iOS-only implementation when native cannot remain shared
component/index.android.tsx  Android-only implementation when native cannot remain shared
component/types.ts           renderer-neutral public contract
```

Prefer a component directory once variants exist. Do not rename every existing web component in
advance; move it into this shape when its first native renderer is implemented. Both renderers must
export the same public component names and shared props. Platform-only affordances may be explicit
compound members when the difference is honest, such as a native drag handle or a web close button.

Keep shared modules free of DOM, Base UI, StyleX, React Native, and Expo imports. Shared code may own
props, state machines, accessibility intent, formatting, and pure behavior. Renderer files own host
elements, refs, events, focus management, gestures, animation, and styling.

## Core and skill boundary

- `@honk/ui` is the core public package. Do not publish parallel `ui-web` and `ui-native` component
  APIs; platform resolution stays behind this package's exports.
- Shared component contracts and future machine-readable component metadata belong in core and must
  remain importable without a DOM or React Native runtime.
- The `honk-ui` skill is workflow guidance. It validates the Expo consumer through its package
  typecheck and the repository design lint; do not introduce a parallel UI-specific CLI.

## Web renderer

- Use DOM semantics, Base UI where it already supplies the behavior, and StyleX for component
  primitives.
- Existing web-only primitives read values from `tokens.stylex.ts`. Cross-platform primitives read
  shared values from the generated `platform-tokens.stylex.ts`; no raw design values at call sites.
- Tailwind remains a token-backed layout channel, not a component override channel.
- Plain CSS is limited to globals, third-party surfaces, and native/Electron chrome contracts.
- Keep hover behind `(hover: hover)` and pair motion with reduced-motion behavior.

## Native renderer

- Use React Native and Expo primitives. CSS, Tailwind, DOM elements, Base UI, and StyleX output do
  not cross into native files.
- Prefer file resolution for web/native differences. Within a native renderer, use
  `process.env.EXPO_OS` only for small iOS/Android behavior differences; split `.ios`/`.android`
  files when the implementations materially diverge.
- Use native focus, keyboard, safe-area, gesture, haptic, and accessibility behavior instead of
  recreating web behavior with JavaScript.
- Keep Honk's semantic token names and product status language. A native value resolver may map
  system chrome to platform semantic colors, but it must not invent a second component vocabulary.
- Continue to use `central-icons`. Do not copy Bluesky's icon set or add another icon library.

`theme.ts` is the representation-neutral source for values shared by web and native.
`platform-tokens.stylex.ts` is generated from it, while native renderers resolve a concrete theme
directly. CSS expressions in the remaining web-only token source are representations, not a second
cross-platform palette.

## Bluesky research protocol for mobile components

Bluesky is required prior art for native interaction behavior. Before implementing or materially
changing a native primitive:

1. Inspect the current `bluesky-social/social-app` source, recording the commit reviewed.
2. Read the shared/default implementation and every relevant platform variant, not a search snippet.
3. Extract behavior, accessibility, keyboard, focus, gesture, and lifecycle lessons. Do not copy
   Bluesky branding, product structure, icons, or obsolete APIs.
4. Verify the lesson against Honk's installed Expo/React Native types and product requirements.
5. Record non-obvious platform decisions beside the Honk component or in its local README.

Start with these source paths, then follow their imports:

- Text field: `src/components/forms/TextField.tsx`
- Dialog: `src/components/Dialog/index.tsx` and `index.web.tsx`
- Menu: `src/components/Menu/index.tsx` and `index.web.tsx`
- Button: `src/components/Button.tsx`
- Typography: `src/components/Typography.tsx`
- Platform conventions: root `CLAUDE.md`, section `Platform-Specific Code`

Bluesky's default file is often the native implementation and `.web` is the override because it is a
single React Native app. Honk is a package, so resolver and export conditions must be verified in
both the Expo consumer and the web consumer before adopting that exact default.

## Text fields are a proof component

Use Field/TextField as the first end-to-end native proof because it exercises the boundary better
than a decorative primitive. A native implementation must explicitly cover:

- shared label, error, disabled, required, multiline, leading, trailing, and size semantics;
- uncontrolled `defaultValue` by default, with controlled `value` supported only when required;
- native `TextInput` refs, `onChangeText`, autofill/content type, input mode, submit behavior,
  keyboard appearance, selection, and secure entry;
- iOS/Android text metrics and multiline vertical alignment without forcing web padding values;
- focus/error chrome, placeholder contrast, font scaling, and screen-reader labeling;
- keyboard avoidance and focus retention when fields live in sheets, dialogs, or menus.

Do not make the shared prop type a union of DOM input props and React Native `TextInputProps`. Define
the product contract, then keep renderer escape hatches narrow and platform-specific.

## Platform behavior contracts

- Dialog: modal/focus trap on web; sheet or native modal presentation on mobile. Post-close actions
  run only after dismissal finishes.
- Menu: anchored dropdown on web; native menu or bottom sheet on mobile. Preserve action grouping and
  destructive intent while adapting presentation.
- Tooltip: hover/focus help on web; do not assume hover exists on mobile. Use an honest mobile
  affordance or omit decorative help.
- Tabs and lists: pointer/keyboard behavior on web; touch targets, gestures, and native scrolling on
  mobile. Product state and ordering remain shared.

## Verification

- Run `pnpm --filter @honk/ui typecheck` for web changes and `node .design/lint.mjs`.
- Run `pnpm run check:mobile` whenever shared theme values, platform exports, the shared OpenCode
  client, or the Expo consumer changes.
- Once a mobile consumer exists, every shared/native change must typecheck through that consumer and
  be exercised on iOS and Android. A web-only typecheck is not evidence of native support.
- Test component behavior on each affected platform. Do not use a web snapshot as the native
  verifier.
