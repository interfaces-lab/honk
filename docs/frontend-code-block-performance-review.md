# Frontend code-block performance review

## Question

Can assistant code blocks and structured read/write previews recover the former ChatView treatment
without adding startup work or slowing transcript paint?

## Evidence

- `docs/cursor-parity-handbook.md` says to recover the product rule from the reference and implement
  it through Honk's current components and tokens.
- Git parent `2fafa7fdd^` owns the former ChatView implementation. Its
  `packages/app/src/styles/markdown.css` rule for `.chat-markdown-codeblock pre` uses an unnumbered
  code frame with a 12px inset, 8px radius, 12px-equivalent mono type, and 18px-equivalent leading.
- The same implementation uses Pierre only to produce highlighted token spans. ChatView owns the
  frame, spacing, typography, overflow, and hover copy control.
- Current assistant Markdown adds a visible line-number child to every source line. A plain 100-line
  fallback therefore creates 200 line-related spans before syntax token spans.
- Current Pierre-backed read/write previews let Pierre choose its internal 8px block gap and 1ch line
  inset. The Honk wrapper only supplies the outer paint and type tokens.

## Decision

Restore the old ChatView code-frame geometry through the existing Prose and Honk token owners.
Remove assistant line-number children because the old code block has no gutter and the numbers add
DOM and width to every line. Give Pierre-backed source previews the same 12px inset while retaining
Pierre for syntax tokenization.

Do not change inline diffs. Their line numbers and added or removed row paint communicate patch data,
so they are not prose code blocks.

Do not add a new loading placeholder. The permanent static UI is the code frame itself. Code blocks
do not exist on the empty Home route or before a transcript contains code, and Pierre source previews
already wait for their grammar before mounting.

## Performance expectation

- Home and empty-thread first paint should remain unchanged because the thread route is lazy and no
  new eager import is introduced.
- A transcript containing code should do less work because plain fallback rendering drops two spans
  per line and highlighted rendering drops one line-number span per line.
- Source-preview geometry changes only CSS variables and StyleX declarations. It adds no React state,
  effects, observers, or event listeners.

## Dev-time verification

Before implementation:

- Run the focused Markdown test as the behavioral baseline.
- Start `pnpm --filter @honk/app dev:startup-review`; the startup graph guard must pass before Vite is
  considered ready.

After implementation:

- Render a 100-line streaming fence in the focused test and assert that it has no line-number nodes.
- Run the focused Markdown, Prose, and tool-message tests.
- Run app and UI typechecks, `pnpm run lint:design`, and the startup review again.
- Compare the frontend startup graph. The change is acceptable only if it adds no eager modules and
  does not increase eager application bytes.

No release runtime benchmark is planned. The relevant rendering change is structural and can be
verified in development by the removed per-line DOM and unchanged startup graph.

## Results

- The 100-line streaming fence dropped from 200 line-related spans to zero. The focused test locks
  that structure down.
- The startup graph stayed at 105 eager app modules and 869.9 KiB of source before and after.
- Production first-load assets dropped from 1,701,487 to 1,701,434 raw bytes and from 519,304 to
  519,275 gzip bytes. The change adds no startup payload.
- The lazy thread surface dropped from 244,966 to 244,564 raw bytes and from 75,981 to 75,769 gzip
  bytes.
- The focused app tests passed with 23 tests. The focused Prose test passed with four tests. The app
  production build passed, UI typecheck passed, and the exact root `pnpm dev` path built Electron,
  started the renderer, reached a healthy sidecar, and created the main window.
- App typecheck still reports the inherited `onboarding-layout.tsx` `gearColossus` error. Design lint
  still reports the 12 dormant v2 findings, and the architecture check still reports the same five
  oversized files. None are in this change.

No new rendered screenshot was supplied. The geometry and behavior are code-verified against the
former ChatView source and bounded tests, not visually verified in a running app.
