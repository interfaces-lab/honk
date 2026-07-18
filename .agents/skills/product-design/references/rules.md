# Accepted rules

## rule/inset-single-panel

**Status:** accepted  
**Scope:** desktop shell and thread surfaces.  
**Rule:** Use one inset panel divided by hairline regions, not nested or sibling cards.  
**Rationale:** One panel preserves the window and thread as a single navigable object; hierarchy comes
from regions and layers rather than boxes inside boxes.  
**Evidence:** `packages/ui/src/shell.tsx`; `../exemplars/shell-tabs-and-status.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §1.  
**Exceptions:** Embedded third-party tools are not settled.

Bad: add a card inside the thread card.  
Good: add a `Shell.Region` division.

## rule/status-vocabulary

**Status:** accepted  
**Scope:** user-visible status indicators.  
**Rule:** Use the fixed working/done/needs-you/failed/draft/unread/idle vocabulary and do not reuse its
colors for identity.  
**Rationale:** One stable status alphabet lets attention travel consistently between rows, tabs, and
Home.  
**Evidence:** `packages/ui/src/matrix.tsx`, `packages/ui/src/tabs.tsx`;
`../exemplars/shell-tabs-and-status.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §2.  
**Exceptions:** None accepted.

Bad: use green to identify a tool or invent blue for a new running state.  
Good: map working to Matrix and done to the existing green status treatment.

## rule/assistant-text-not-bubbles

**Status:** accepted  
**Scope:** conversation output.  
**Rule:** Only user messages use bubbles; assistant output uses the four-role text ramp without
tool-call status icons.  
**Rationale:** Type roles preserve a text-first transcript and keep tool evidence subordinate to the
assistant's answer.  
**Evidence:** `packages/ui/src/tool-call.tsx`, `packages/ui/src/user-message.tsx`,
`packages/ui/src/status-row.tsx`, `packages/ui/src/work-group.tsx`;
`../exemplars/conversation-family.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §3.  
**Exceptions:** None accepted.

Bad: add a green check and bordered bubble around a tool call.  
Good: use a muted verb with a faint path and mono evidence where needed.

## rule/color-reports-state

**Status:** accepted  
**Scope:** product UI.  
**Rule:** Reserve color for status and focus/primary intent; communicate identity with shape and text.  
**Rationale:** Decorative identity color spends the limited signal needed for state and attention.  
**Evidence:** `packages/ui/src/theme.ts`, `packages/ui/src/icon.tsx`;
`../exemplars/tokens-and-leaves.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §4.  
**Exceptions:** Product content whose color is itself data must remain truthful.

Bad: assign each tool a colorful icon for liveliness.  
Good: use one neutral glyph vocabulary and reserve accent for focus or primary intent.

## rule/audience-dial-does-not-fork

**Status:** accepted  
**Scope:** builder/engineer wording.  
**Rule:** The dial changes vocabulary and density, never feature access or status glyphs.  
**Rationale:** Both audiences operate on the same product objects and capabilities; a forked feature
model makes the preference into an entitlement tier.  
**Evidence:** `packages/ui/src/preset-dial.tsx`; `glossary.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §5.  
**Exceptions:** None accepted.

Bad: hide a capability in builder mode.  
Good: relabel `Commit & Push` as `Ship it` while invoking the same action.

## rule/honest-controls-and-notices

**Status:** accepted  
**Scope:** controls, conversation receipts, and feedback.  
**Rule:** Expose a control only when its effect exists; durable notices are stream parts; turn diffs use
the actionable change receipt rather than a decorative divider; transient local feedback may use the
shared toast.  
**Rationale:** Chrome earns trust only when it corresponds to a real effect or durable product object.  
**Evidence:** `packages/ui/src/change-receipt.tsx`, `packages/app/src/thread/transcript-turn.tsx`,
`packages/ui/src/tool-call.tsx`; `../exemplars/conversation-family.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §6.  
**Exceptions:** Action failures may toast when they have no durable home.

Bad: render a fake clear action or a decorative turn divider after changed files.  
Good: omit an unavailable action and render `ChangeReceipt` for reviewable turn diffs.

## rule/close-does-not-stop-work

**Status:** accepted  
**Scope:** desktop close and dismiss behavior.  
**Rule:** Closing hides a view and does not cancel work.  
**Rationale:** The desktop mental model is a browser whose work continues outside the visible tab.  
**Evidence:** `packages/app/src/tab-store.ts`; `references/surfaces-desktop-shell-workbench.md`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §7.  
**Exceptions:** Explicit stop controls may cancel work.

Bad: wire Command-W to interrupt the active agent.  
Good: close the focused tab while the run remains available in the deck.

## rule/composer-queues

**Status:** accepted  
**Scope:** thread composer.  
**Rule:** Enter always enqueues; idle drain makes it feel immediate, running work reveals queue
management, and Command-Enter steers.  
**Rationale:** One queue behavior avoids exposing send-versus-queue modes to the user.  
**Evidence:** `packages/app/src/thread/composer.tsx`, `packages/app/src/composer/submission.ts`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §8.  
**Exceptions:** None accepted.

Bad: offer separate Send and Queue input modes.  
Good: preserve one enqueue action and adapt its label and draining behavior to run state.

## rule/one-command-menu

**Status:** accepted  
**Scope:** global find and action affordances.  
**Rule:** Reuse one engine and fixed Start new → threads → commands ranking across Home, Command-K,
and Command-O.  
**Rationale:** Stable ranking and one engine keep Enter predictable across entry doors.  
**Evidence:** `packages/app/src/command-menu.tsx`, `packages/app/src/command-menu-model.ts`,
`packages/app/src/command-menu-store.ts`.  
**Accepted decision source:** commit `1316b770a670`, product-design principle §9.  
**Exceptions:** Focused composite menus such as the composer's `/` and `@` suggestions are not global
find/action affordances.

Bad: create a separate smart-ranked thread picker.  
Good: open the shared command-menu engine through the threads door.

## rule/shared-control-chrome

**Status:** accepted  
**Scope:** `packages/app` product controls.  
**Rule:** Use shared controls and do not repaint their visual chrome at call sites.  
**Rationale:** Shared controls keep interaction behavior and appearance under one owner.  
**Evidence:** `packages/ui/dev/main.tsx`, `packages/ui/src/button.tsx`;
`../exemplars/controls-and-menu.md`, `../exemplars/anti-exemplar-call-site-controls.md`.  
**Accepted decision source:** existing deterministic rules `honk/design-no-raw-button` and
`honk/design-no-canonical-control-overrides`.  
**Exceptions:** Focus-sensitive Lexical composite options retain required semantics and must document
the exception.

Bad: add a raw product `<button>` or override a shared Button's paint at the call site.  
Good: use the shared control and place it with a layout wrapper.
