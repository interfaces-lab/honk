# @honk/ui agent rules

`@honk/ui` is one design-system API with platform-resolved renderers. Web, iOS, and Android expose
the same product capabilities and semantic component contracts; their markup, interaction
primitives, and presentation may differ when the platform requires it.

Native support is incremental: the Expo consumer now exercises platform-resolved Text, Button,
IconButton, Picker, ListRow, Checkbox, Switch, Matrix, and TextField leaves. The rest of the package
remains web-only until each component gains a real native renderer. Never imply package-wide native
support from these leaves, and do not add placeholder native files or unused React Native
dependencies.

## One API, platform-resolved implementations

Import a component through its unsuffixed public path. Never import a `.web`, `.native`, `.ios`, or
`.android` file directly, and never choose an implementation with `require()`, dynamic `import()`,
or a runtime web/native conditional.

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

## Web renderer

- Use DOM semantics, Base UI where it already supplies the behavior, and StyleX for component
  primitives.
- Tailwind remains a layout channel, not a component override channel.
- Plain global CSS is limited to roots/resets, vendor baseline imports, and native/Electron chrome
  contracts. Component-scoped third-party DOM adapters use a colocated CSS module.
- Keep hover behind `(hover: hover)` and pair motion with reduced-motion behavior.

## Native renderer

- Use React Native and Expo primitives. CSS, Tailwind, DOM elements, Base UI, and StyleX output do
  not cross into native files.
- Prefer file resolution for web/native differences. Within a native renderer, use
  `process.env.EXPO_OS` only for small iOS/Android behavior differences; split `.ios`/`.android`
  files when the implementations materially diverge.
- Use native focus, keyboard, safe-area, gesture, haptic, and accessibility behavior instead of
  recreating web behavior with JavaScript.
- Continue to use `central-icons`. Do not add another icon library.

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

- Run `pnpm --filter @honk/ui typecheck` for web changes and `pnpm run lint:design`.
- Run `pnpm run check:mobile` whenever shared theme values, platform exports, the shared OpenCode
  client, or the Expo consumer changes.
- Once a mobile consumer exists, every shared/native change must typecheck through that consumer and
  be exercised on iOS and Android. A web-only typecheck is not evidence of native support.
- Test component behavior on each affected platform. Do not use a web snapshot as the native
  verifier.
