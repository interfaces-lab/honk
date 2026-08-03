# Cursor code handbook

Use Cursor as a behavioral and architectural reference, not as a code donor.
Recover the product rule behind a feature, then express that rule with Honk's
own state model, components, and tokens.

## Freeze the reference

Cursor's installed application lives at `/Applications/Cursor.app`. Inspect
these artifacts together:

| Artifact                                                 | What it can establish                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Contents/Resources/app/package.json` and `product.json` | Build identity, product configuration, registered endpoints, and extension policy |
| `out/vs/workbench/workbench.desktop.main.js`             | Desktop entry bundle: shipped workbench and agent code paths                      |
| `out/vs/workbench/workbench.glass.main.js`               | Shared workbench and agent paths plus Glass-specific shell paths                  |
| The matching `.css` files                                | Named rules, token declarations, geometry, overflow, and responsive rules         |
| `workbench.anysphere-ui-automations.js`                  | Shipped automation UI behavior, labels, and interaction anchors                   |

Record the version and checksums before investigating:

```sh
CURSOR_APP=/Applications/Cursor.app
CURSOR_RESOURCES="$CURSOR_APP/Contents/Resources/app"

plutil -extract CFBundleShortVersionString raw \
  "$CURSOR_APP/Contents/Info.plist"
shasum -a 256 \
  "$CURSOR_RESOURCES/out/vs/workbench/workbench.desktop.main.js" \
  "$CURSOR_RESOURCES/out/vs/workbench/workbench.desktop.main.css" \
  "$CURSOR_RESOURCES/out/vs/workbench/workbench.glass.main.js" \
  "$CURSOR_RESOURCES/out/vs/workbench/workbench.glass.main.css" \
  "$CURSOR_RESOURCES/out/vs/workbench/workbench.anysphere-ui-automations.js"
```

Checksum every artifact used. The installed bundles are minified and may have
no source maps. They establish which client paths shipped and, when the runtime
gates are traceable, the behavior those paths implement. They cannot prove that
every path executes, original identifiers, full source structure, unbundled
implementation, Cursor's cloud implementation, or its internal build process.
Mark those as unknown instead of filling the gaps with guesses.

## Investigate a question, not a screenshot

Start with a concrete question: “What owns queued prompts while a subagent is
running?” is better than “find the queue component.”

Search for stable labels, setting keys, data attributes, event names, or log
messages:

```sh
CURSOR_WORKBENCH=/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js

rg --byte-offset -o -F "Start Multitasking" "$CURSOR_WORKBENCH"
rg -o -P '.{0,1500}Start Multitasking.{0,3000}' "$CURSOR_WORKBENCH"
```

Record an anchor as the artifact checksum, byte offset, and a short unique
search string or context. Prefer `rg --byte-offset`; JavaScript `indexOf`
reports a UTF-16 string index, which is not necessarily a file byte offset.

Then trace the behavior in both directions:

1. Find the render owner and its render gate.
2. Follow the state read to its store, handle, service, or controller.
3. Follow each action to the command that changes state.
4. Find persistence, transport, rollback, and recovery behavior.
5. Find the error, logging, metrics, or timeout path.

Do not assume the framework owns the state. Cursor mixes React islands, Solid
surfaces, and service-backed objects. A component may only project a
service-owned composer handle whose underlying data is persisted elsewhere.

Do not stop at a token declaration either. Glass-scoped CSS can override base
tokens, so trace the cascade from the token through the element's actual class.

For every conclusion, use one of these labels:

- **Fact** — directly supported by the recorded artifact and an exact anchor.
- **Inference** — the best explanation connecting multiple facts.
- **Unknown** — not recoverable from the installed client.

Minified symbol names are temporary clues, not stable architecture.

## Recover the model before the chrome

Before editing Honk, answer:

- What is the canonical object: task, composer, plan, queue, or subagent?
- Which fields are durable, and which are ephemeral view state?
- What are the valid transitions, guards, terminal states, and rollback paths?
- Is state scoped to the main agent, one subagent, or the workspace?
- Does the surface render shared state or create a second source of truth?
- Is its size measured from content or reserved in advance?
- Which setting owns the behavior, copy, pointer affordance, or density?

For the current agent UI, start with and adapt this state matrix:

| Axis         | States                                 |
| ------------ | -------------------------------------- |
| Conversation | empty, active, complete, failed        |
| Ownership    | main agent, subagent, nested subagent  |
| Prompt       | empty, draft, queued, submitting       |
| Mode         | Build, Plan, Debug, Ask, Multitask     |
| Surface      | hidden, collapsed, expanded, scrolling |

Treat these as investigation axes, not a claim that every label is a canonical
Cursor mode. In this snapshot, Build is submitted through multitask mode as
plan execution, while “Debug Mode” also appears as a suggested UI state.

Verify whether queue policy follows the agent receiving the prompt rather than
a workspace-wide busy flag.

## Parallelize evidence, centralize judgment

When an investigation is large, split it into bounded questions such as state
ownership, rendering and CSS, transport and persistence, or tests and
observability. Every investigator must use the same recorded version and
checksums and return:

- exact artifact anchors;
- facts, inferences, and unknowns;
- the state transitions and canonical owner;
- the smallest likely Honk mapping.

One lead verifies the anchors and reconciles conflicting interpretations before
any shared primitive or state model changes. Parallel discovery should not
produce parallel sources of truth.

## Translate, do not transplant

Write the mapping before writing code:

```text
Cursor evidence
→ product invariant
→ Honk canonical owner
→ smallest implementation change
→ behavioral verification
```

Use existing Honk boundaries:

- shared bounded status surfaces use `Tray`;
- task rows use the canonical task-list primitive;
- controls use shared buttons and `central-icons`;
- geometry, type, color, and motion use design tokens;
- protocol behavior stays behind the runtime client boundary.

If Plan, Debug, Todo, Queue, and worker status share Cursor's chrome, give them
one Honk primitive with explicit variants. Keep their state machines separate.
Shared chrome does not mean shared business state.

Keep Cursor read-only. Do not patch it, import from it, preserve long minified
excerpts, or reproduce its private module structure. Cite short anchors and
implement the independently understood rule.

## Verify the rule

Verify behavior before pixel polish:

1. The correct owner renders the surface in every matrix state.
2. Actions change the same canonical state the reference changes.
3. Failure, rollback, dismissal, focus, and keyboard paths work.
4. Dynamic content changes measured height and scroll obstruction correctly.
5. Width, padding, line height, radius, borders, fades, and pointer behavior
   match the same Cursor version, state, window width, theme, and display scale.
6. Targeted behavioral tests, typechecks, and `pnpm run lint:design` pass.

Do not open or control a browser or running Honk instance for runtime QA or
runtime logging. Use user-provided screenshots and observations as rendered
evidence, and use source inspection plus bounded checks for behavior. If new
desktop-only visual proof is indispensable, stop and ask the user to capture or
exercise the exact state; do not start or restart the app or persistent stack.
When that evidence is unavailable, report the result as code-verified, not
visually verified.

## Investigation note

```md
### Question

- Cursor version and artifact checksums:
- Search anchors:
- Facts:
- Inferences:
- Unknowns:
- Canonical owner and transitions:
- Honk mapping:
- Behavioral verification:
- User-provided visual evidence:
- Remaining mismatch:
```

This note is the useful handoff. A screenshot alone cannot establish behavior,
and a raw bundle excerpt cannot explain the product rule.
