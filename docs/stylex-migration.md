# Canonical styling ownership

Honk has one semantic styling contract across web, desktop, and native. Shared component chrome is
owned by `@honk/ui`; app code composes those controls without repainting them.

## Palette and implementation sources

The sources are deliberately split by responsibility:

- Light colors follow Cursor 3.11.25's bundled workbench core in
  `workbench.desktop.main.js` and the bundled Cursor Light theme. The workbench source is
  authoritative where its generated semantic palette supersedes the extension JSON. Bluesky
  remains the required interaction prior art for native leaves.
- Dark colors restore Honk's prior git palette, based on
  [BioHazard786/cursor-theme-vscode](https://github.com/BioHazard786/cursor-theme-vscode/blob/main/themes/cursor-dark.json).
  Its stable anchors are `#141414` chrome, `#181818` editor/inset, `#252526` elevation,
  `#E4E4E4EB` foreground, and Honk's `#599CE7` Cursor-derived accent.
- OpenCode informs workbench role hierarchy and the blocking no-flash appearance preload. Its
  concrete colors are not copied into Honk.
- [Astryx](https://github.com/facebook/astryx) informs StyleX capability checks and deterministic
  migration enforcement. Honk keeps its narrower `HonkStyle` boundary instead of adding `xstyle`.

`packages/ui/src/theme.ts` records provenance per color and is the only authored source for shared
concrete values. `packages/ui/src/theme-parity.json` locks accepted palette keys and the generator
refuses unreviewed drift.

## Component decision table

| User intent                         | Canonical primitive                       | Use it for                                                             | Do not use it for                             |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Momentary command                   | `Button` / `IconButton`                   | Save, send, attach, reset, disconnect, open a panel                    | A selected value or persistent navigation row |
| Single selected value               | `Picker`                                  | Theme, density, model preset, project location, agent, model variant   | A transient command menu                      |
| Persistent collection or navigation | `ListRow`                                 | Projects, threads, settings sections, question choices, workbench rows | A compact one-off command                     |
| Transient command                   | `Menu.Item`                               | Context actions and multi-action overflow menus                        | Rich model cards or persistent selected rows  |
| Editor-owned search result          | Listbox option with canonical row anatomy | `/` and `@` results that must retain Lexical focus                     | A Button that steals editor focus             |

Buttons expose only primary, neutral, quiet, and destructive emphasis. A surface gets one fill or
one hairline; selected, hover, open, and focus states remain visually distinct. The Controls story
in `packages/ui/dev/main.tsx` is the cluster acceptance fixture, including long labels, narrow
bounds, rich Picker options, disabled/selected states, and a real composer footer.

## Styling ownership

| Layer                       | Owns                                                                                          | Rules                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `theme.ts`                  | Shared concrete colors and metrics                                                            | Edit here, update provenance/parity, then run the token synchronizer                    |
| Generated platform tokens   | StyleX vars and static first-paint CSS                                                        | Never edit `platform-tokens.stylex.ts` or `platform-tokens.css` by hand                 |
| `tokens.stylex.ts`          | Stable public facade plus web-only elevation, motion, z-index, shell, toast, and prose values | No duplicate shared `defineVars` blocks                                                 |
| StyleX in `@honk/ui`        | Primitive anatomy, variants, interaction state, focus, and component-owned transitions        | Read semantic token vars; hover is pointer-gated and motion has a reduced-motion branch |
| Tailwind in app code        | Static layout and wrapper composition                                                         | Use token-backed utilities; no raw color, pixel, or timing values                       |
| Named app StyleX intrinsics | Runtime or fixed geometry that cannot be represented by a semantic utility                    | Keep it isolated and justify the constant; it cannot repaint shared control chrome      |
| CSS modules                 | Third-party DOM internals owned by one component                                              | Use token vars; Sonner is the canonical example                                         |
| Global CSS                  | Root/reset substrate, scrollbar/window-drag contracts, vendor baseline imports                | No product `data-slot`, Sonner, or xterm component selectors                            |
| JS renderer adapters        | Shiki, xterm, Electron, and React Native concrete values                                      | Resolve from `honkTheme` or live token vars, never keep a parallel palette              |

The generated static CSS is imported before React paints, while the blocking script in
`packages/app/index.html` restores `color-scheme`. Electron uses the same theme source for its
initial background and runtime native theme source, so there is no blue or white host flash around
the web surface.

## Migration ledger

| Wave              | Status   | Landed contract                                                                                                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme foundation  | Complete | Renderer-neutral theme, provenance/parity fixture, generated StyleX/static CSS, facade exports, Tailwind aliases, no-flash preload, appearance storage key, desktop adapter |
| Renderer themes   | Complete | Dual Honk Shiki themes, full xterm ANSI theme with live appearance/font updates, Electron background/native source, native `resolveNativeTheme()`                           |
| Control family    | Complete | Flat Button variants, persistent ListRow anatomy/state, platform-resolved rich Picker, Controls gallery and composer cluster fixture                                        |
| Composer pilot    | Complete | Model and location Picker, quiet mode command, canonical attachment/send controls, canonical focus-preserving `/` and `@` option anatomy                                    |
| App consumers     | Complete | Settings pickers/navigation, home project/thread rows, question choices, workbench rows, directory access controls, and raw action replacements                             |
| Static app leaves | Complete | Tasks, files, changes, directory-picker, and update-pill wrappers use Tailwind; only named intrinsic bounds remain in StyleX                                                |
| Native leaves     | Complete | Platform-resolved Text, Button/IconButton, Picker, ListRow, Checkbox, Switch, Matrix, and TextField; mobile duplicate control paint removed                                 |
| CSS escapes       | Complete | Sonner selectors colocated in `toast.module.css`; xterm vendor baseline remains a global package import                                                                     |
| Enforcement       | Complete | Duplicate vars, null overrides, raw values/buttons, shared-control chrome overrides, stale paths, generated token drift, and global selector policy are deterministic gates |

## Required verification

Run the affected package typecheck after each wave. A shared/native or theme change also requires:

```sh
pnpm --filter @honk/ui check:tokens
node .design/lint.mjs
pnpm run lint:css
pnpm run check:mobile
pnpm run typecheck
```

Use an already-running gallery/app for visual review; do not start a development server implicitly.
Review light and dark, desktop and narrow widths, hover/focus/pressed/disabled/open/selected states,
overlays, long content, and iOS/Android for affected native leaves.
