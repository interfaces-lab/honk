# @honk/app Architecture

The app is a Promise-client UI layer. It coordinates user turns, projects chat rows, and subscribes to runtime overlays. It does not import Pi, execute agents, or synthesize durable orchestration facts from runtime streams.

## Package Boundaries

| Package            | Allowed                                                              | Forbidden                                                                                                    |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/app`     | `@honk/shared`, `@honk/api`, React/Zustand UI state, bridge wrappers | Pi imports, Core internals, Effect services in stores, IPC channel strings, renderer synthesis from Pi events |
| `packages/desktop` | Core process launch, IPC, aux services, Electron integration         | Pi types in renderer/preload, app UI state                                                                   |
| `@honk/core`       | Harness execution, durable thread state, auth, terminal runtime      | React, app stores, desktop IPC                                                                               |
| `@honk/shared`     | Shared schemas, model types, bridge contracts                        | App, desktop, or Core implementation details                                                                 |

## Agent-Adjacent SDK Surfaces

| API              | Transport     | Owns                                                                         |
| ---------------- | ------------- | ---------------------------------------------------------------------------- |
| `HonkRuntimeApi` | Electron IPC  | Pi execution: `sendTurn`, `abort`, `hydrateThread`, credentials, host events |
| `EnvironmentApi` | WebSocket RPC | Durable orchestration facts, projects, git, terminal, thread snapshots       |
| `LocalApi`       | IPC           | Shell/local UI operations only                                               |

## Chat Invariants

- One `MessageId` per send, assigned in `coordinateTurnSend`.
- `thread-timeline-projector.ts` is the sole semantic row projector.
- `MessagesTimeline` renders rows only; no semantic synthesis.
- `agent-runtime-store` is overlay/subscription state only; desktop main ingests runtime persistence.
- All send paths call `coordinateTurnSend` (composer, git actions, queue/retry, draft, worktree, inline edit, plan follow-up).

## Turn Send Flow

```mermaid
flowchart LR
  UI["Chat UI"] --> Coord["turn-send-coordinator"]
  Coord --> Intent["ThreadSendIntent store"]
  Coord --> Env["EnvironmentApi.thread.turn.start"]
  Coord --> Runtime["HonkRuntimeApi.sendTurn"]
  Env --> Server["OrchestrationEngine"]
  Runtime --> Desktop["DesktopRuntimeHost"]
  Desktop --> Ingestion["runtime-ingestion"]
  Ingestion --> Server
```

## UI Projection

`thread-timeline-projector.ts` inputs:

- committed messages, entries, activities, proposed plans from `EnvironmentApi`
- runtime display overlay from `HonkRuntimeApi` host events
- `ThreadSendIntent[]` for in-flight sends
- active turn state for waiting-row eligibility

Output: ordered `TimelineEntry[]` with stable ids (`message:${MessageId}`).

## Tool Call Density Entry-Point Map

Honk supports exactly three densities (`detailed`, `compact-ungrouped` = Balanced,
`compact-all-grouped` = Compact). Legacy stored values migrate inside the
`ConversationDensity` schema at decode; runtime code never sees them. Cursor symbol
equivalents (from `workbench.desktop.main.js`) are listed so reverse-engineering lands in
the right layer.

| Layer             | Cursor symbol            | Honk file / symbol                                                                                                         |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Storage + migrate | `HFr` key, `XBn` aliases | `@honk/shared/conversation-density` `ConversationDensity` (decode-time legacy migration)                                  |
| Settings UI       | `ETA` + `ATA` slider     | `settings/appearance/appearance-settings-panel.tsx` + `tool-call-density-control.tsx` (slider + live preview)              |
| Config read       | `f4o` / `GMS` / `Cjt`    | `hooks/use-settings.ts` → `hooks/use-conversation-density.ts`                                                              |
| Distribution      | `F5r` / `SCe` context    | hook + prop (`messages-timeline.tsx`, `tool-message.tsx`) — no provider                                                    |
| Transcript rows   | `aof` + `pqb`/`cof`      | `thread-timeline-projector.ts` (density-agnostic) → `timeline-render-items.ts` `deriveTimelineRenderItems` (density-aware) |
| Step grouping     | `NAm` + `Wot`/`Hot`      | `deriveTimelineRenderItems` + `@honk/shared/conversation-density` predicates                                               |
| Group chrome      | `A4b` / `LRm`            | `timeline/step-renderer.tsx` `GroupedStepsRenderer` (header verb + `WorkGroupPreview` 144px strip)                         |
| Tool router       | `MRm`                    | `message/tool-renderer.tsx` `ToolCallRenderer`                                                                             |
| Edit UI           | `XJr`                    | `EditToolCall` (detailed card + collapsed diff; compact minimal line)                                                      |
| Shell UI          | `kRm`                    | `ShellToolCall` detailed card; compact = `ExpandableToolMetadataLine` accordion                                            |
| Subagent task     | `O4b`                    | `taskToolCall` branch (`TaskToolCall`); nested transcript lives in the subagent tray, not inline                           |

Grouping boundaries are user-visible entries only (user messages, extension UI requests,
transcript-scale assistant text). Orchestration turn ids are ignored: runtime-driven
continuations (GitAction flows, `ask_user` resumes) mint a new turn id per segment inside
one visible run.

Known divergences from Cursor (deliberate):

- No feature flag — the stored density always applies.
- Pending approval → detailed-card override exists in `ToolCallRenderer`
  (`resolveEffectiveToolCallDensity`), but approvals carry no `toolCallId` in
  `ApprovalRequestedActivityPayload`, so timeline rows and grouping cannot correlate to
  approvals; approvals surface in the composer panel instead.
- Density is hook-per-consumer, not a React context provider.
