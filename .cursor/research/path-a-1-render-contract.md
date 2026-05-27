# Path A slice 1: `ui-task-tool-call__body` renderer contract

Asset: `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` (61221385 bytes, mtime 2026-05-25 06:57:18).

Multi sources read 2026-05-26.

---

## 1. `renderStep` signature

### 1.1 Call sites in `wsv` and `ysv`

**`wsv` wraps parent `renderStep` as `B` (3-arg passthrough):**

| Field | Value |
| ----- | ----- |
| Byte offset | 3504886 |
| Line | 639 |

```text
M=_((ee,ne,re)=>s?s(ee,ne,re):null,"t7")
```

**`wsv` passes `B` into each turn via `ysv`:**

| Field | Value |
| ----- | ----- |
| Byte offset | 3506491 |
| Line | 639 |

```text
k.map(ee=>$(ysv,{turn:ee,renderStep:B},ee.turnIndex))
```

**`ysv` passes `renderStep` into `Udd`:**

| Field | Value |
| ----- | ----- |
| Byte offset | 3504156 |
| Line | 639 |

```text
o=$("div",{className:"ui-turn-view",children:$("div",{className:"ui-turn-view__steps",children:$(Udd,{steps:s,renderStep:i})})})
```

### 1.2 What `step` is (`nhd` + `_Rh`)

**Turn → flat steps (`nhd`):**

| Field | Value |
| ----- | ----- |
| Byte offset | 3503682 |
| Line | 639 |

```text
function nhd(n){return n.steps.filter(e=>e.type==="loaded").map(e=>e.step).filter(e=>!(e.type==="assistant-message"&&e.message.trim().length===0))}
```

- Turn wrapper items use `type === "loaded"`; payload is `.step`.
- Empty `assistant-message` steps are dropped.

**Step discriminant (`_Rh` / `UiStepRenderer`):** byte 3540273, line 644.

| `step.type` | Rendered as |
| ----------- | ------------- |
| `"assistant-message"` | `Wsv` → markdown (`V4`) |
| `"tool-call"` | `vRh` (`ToolCallRenderer`) |
| `"thinking"` | `T5r` |
| default | `return t` (passthrough) |

```text
switch(t.type){case"assistant-message":{...$(Wsv,{message:t.message})...}case"tool-call":{...$(vRh,{toolCall:t.toolCall,...,renderStep:s,...})...}case"thinking":{...$(T5r,{thinking:t.thinking,...})...}default:return t}
```

**`tool-call` step fields used at call site (byte 3541389):** `toolCall`, `callId`, `status`, `error`, `approval`, `editToolCallDisplay`, `startedAtMs`, `subagentConversation`, `backgroundNudgeDelayMs`, `showBackgroundNudge`, `onSendToBackground`.

### 1.3 What `ctx` is (3rd argument)

**Defined at `ihd` (GroupedSteps wrapper) — byte 3542763, line 644:**

```text
A=_((M,B,U)=>$(_Rh,{step:M,index:B,generating:i,renderStep:A,onFileClick:m,onUrlClick:h,onNestedToolExpand:U?.onNestedToolExpand,defaultExpanded:M.type==="tool-call"&&U?.expandedToolCallId===M.callId}),"renderStep")
```

| `ctx` field (3rd arg `U`) | Maps to `_Rh` prop |
| ------------------------- | ------------------ |
| `onNestedToolExpand` | `onNestedToolExpand` |
| `expandedToolCallId` | `defaultExpanded` when `M.callId` matches |

**`generating` is not in `ctx`** — it is a separate prop on `_Rh` from parent `loading` (`i` in `ihd`).

**Inside `ui-task-tool-call__body`, `Udd` only passes 2 arguments:**

| Field | Value |
| ----- | ----- |
| Byte offset | 3307404 (end of `Udd` map) |
| Line | 628 |

```text
children:c(M.step,M.stepIndex)
```

So in the task-card body path, **`ctx` is always `undefined`** unless `renderStep` ignores the third parameter. Nested expand (`onNestedToolExpand` / `expandedToolCallId`) is wired in **`hEh`** (work-group preview), not in `Udd` inside `ysv`.

**`hEh` call site (work group — 3-arg `ctx`):** byte 3303170, line 628.

```text
i(M.step,M.index,{onNestedToolExpand:a,expandedToolCallId:c})
```

### 1.4 Return type

- Pipeline returns React elements via minified `$()` / `Re()` helpers.
- Export map (byte 2545636, line 449): `ToolCallRenderer:()=>vRh`, `UiStepRenderer:()=>_Rh`, compact line `q$`.
- **`renderStep` is `(step, index, ctx?) => ReactNode`**, implemented by `ihd`'s closure `A` → `_Rh` → `vRh` / `Wsv` / `T5r` / `q$`.

---

## 2. Step dispatch (`vRh` / `_Rh`)

### 2.1 `vRh` tool-case switch (17 branches + default)

**Entry:** byte 3521657, line 644.

```text
function vRh(n){const e=It(217),{toolCall:t,callId:i,loading:r,startedAtMs:s,hasError:o,approval:a,editToolCallDisplay:c,subagentConversation:d,renderStep:m,onFileClick:h,onUrlClick:f,onNestedToolExpand:g,defaultExpanded:b,showBackgroundNudge:k,backgroundNudgeDelayMs:E,onSendToBackground:A}=n
```

**Cases (regex extract from `vRh` body, byte 3521657–3540000):**

1. `awaitToolCall`
2. `deleteToolCall`
3. `editToolCall`
4. `shellToolCall`
5. `taskToolCall` → `wsv`
6. `updateTodosToolCall`
7. `readToolCall`
8. `grepToolCall`
9. `globToolCall`
10. `lsToolCall`
11. `semSearchToolCall`
12. `webSearchToolCall`
13. `webFetchToolCall`
14. `readLintsToolCall`
15. `getMcpToolsToolCall`
16. `mcpToolCall`
17. `reflectToolCall`
18. **default** → `q$` (`ToolCallLine`)

**`taskToolCall` branch:** byte 3526461, line 644.

```text
case"taskToolCall":{let Y;e[97]!==R||e[98]!==m||e[99]!==d||e[100]!==t?(Y=$(wsv,{toolCall:t,loading:R,subagentConversation:d,renderStep:m}),e[97]=R,e[98]=m,e[99]=d,e[100]=t,e[101]=Y):Y=e[101],B=Y;break e}
```

### 2.2 Reachability inside subagent task body vs top-level timeline

| Dispatch | Inside task body (`ysv` → `Udd` → `renderStep`) | Top-level timeline only |
| -------- | ----------------------------------------------- | ------------------------ |
| `_Rh` `assistant-message` | Yes | Yes |
| `_Rh` `thinking` | Yes | Yes |
| `_Rh` `tool-call` → `vRh` | Yes (all tool cases) | Yes |
| `Udd` group rows (`rXg` / `browser-group` / `waiting-group`) | **No** — `Bdd` grouping in top-level `Udd` only | Yes |
| `hEh` dimmed assistant + thinking-as-markdown | **No** — work-group `hEh` only | Yes (preview/expanded work group) |
| `vRh` cases not produced by subagent runtime | Only if step stream emits them | Same |

Subagent body uses **flat** `Udd` over `nhd(turn)` steps — not grouped `rXg` rows.

### 2.3 Is `taskToolCall` reachable recursively?

**Yes.** `_Rh` `tool-call` passes `renderStep:s` into `vRh` (byte 3541564). `vRh` `taskToolCall` passes `renderStep:m` into `wsv`. A nested subagent task inside an expanded parent task body can render another `ui-task-tool-call`.

### 2.4 `assistant_message` / `assistant-message` markdown?

**Proto field (wire):** byte 15088754, line 6434.

```text
{no:1,name:"assistant_message",kind:"message",T:Grb,oneof:"message"}
```

**UI step type:** `"assistant-message"` (byte 3287506, line 623).

**Rendered inline as markdown:** byte 3539874 (`Wsv`) → byte 3242333 (`V4`).

```text
function Wsv(n){const e=It(4),{message:t,copyText:i}=n,...
a=$("div",{style:o,children:$(V4,{copyText:s,children:t})})
```

**Not** a plain `<span>`; **`V4` is the markdown renderer** (supports streaming via `isStreaming` prop on `V4`).

**`hEh` dim path** (work group only): tertiary text + `renderStep` inside a dim wrapper — byte 3302987, line 628 — separate from `Wsv` full markdown used in `_Rh`.

---

## 3. Turn view (`ysv`) and step list (`Udd`)

### 3.1 `ysv` root JSX

| Field | Value |
| ----- | ----- |
| Byte offset | 3503962–3504156 |
| Line | 639 |

```text
function ysv(n){const e=It(5),{turn:t,renderStep:i}=n;let r;e[0]!==t?(r=nhd(t),e[0]=t,e[1]=r):r=e[1];const s=r;if(s.length===0)return null;let o;return e[2]!==s||e[3]!==i?(o=$("div",{className:"ui-turn-view",children:$("div",{className:"ui-turn-view__steps",children:$(Udd,{steps:s,renderStep:i})})}),e[2]=s,e[3]=i,e[4]=o):o=e[4],o}
```

### 3.2 `Udd` complete iteration

| Field | Value |
| ----- | ----- |
| Byte offset | 3306777 |
| Line | 628 |

```text
function Udd({steps:n,loading:e=!1,showSimulatedThinking:t=!1,simulatedThinkingMessage:i,onSimulatedThinkingCancel:r,showFileChangeStats:s=!0,options:o,stepGap:a=6,renderStep:c}){const{conversationDensity:d}=KDt();let h=pn(()=>Bdd(n,o),[n,o]);const f=Gt(h);h.length>0?f.current=h:e&&f.current.length>0&&(h=f.current);const g=h.length-1,b=h[g],k=b?.type==="group"||b?.type==="browser-group"||b?.type==="waiting-group",E=t&&k,A=t&&!k;return Re("div",{style:{display:"flex",flexDirection:"column",gap:a,"--step-gap":`${a}px`,"--ui-collapsible-content-gap":`${a}px`,"--conversation-font-size":"var(--conversation-tool-font-size)","--card-border-color":"var(--cursor-stroke-secondary)","--conversation-surface-border-radius":"var(--cursor-radius-xl)"},children:[h.map((R,D)=>{if(R.type==="group"||R.type==="browser-group"||R.type==="waiting-group"){const B=e&&D===g;return $("div",{"data-preview-scrollable":"false","data-group-loading":B||void 0,children:$(rXg,{group:R.group,loading:B,showFileChangeStats:s,showSimulatedThinking:E&&D===g,simulatedThinkingMessage:i,onSimulatedThinkingCancel:r,renderStep:c})},`group-${R.startIndex}`)}const M=R;return $("div",{style:{paddingInline:mEh(M.step,d)},children:c(M.step,M.stepIndex)},`step-${M.stepIndex}`)}),A&&$("div",{style:{paddingInline:J4n},children:$(l5r,{message:i,onCancel:r})})]})}
```

| Mechanism | Behavior |
| --------- | -------- |
| **Groups** | `Bdd` may emit `group` / `browser-group` / `waiting-group` → `rXg` |
| **Gap** | Column `gap: a` (default `stepGap=6`), CSS vars `--step-gap`, `--ui-collapsible-content-gap` |
| **Padding** | Per-step `paddingInline: mEh(M.step, d)` where `d` is `conversationDensity` from `KDt()` |
| **Stale steps while loading** | `f.current` retains last non-empty grouped list when `loading && h.length===0` |
| **Simulated thinking** | Trailing `l5r` row with `paddingInline: J4n` when `showSimulatedThinking && !last item is group` |

### 3.3 `J4n`, `i7h`, `mEh`

| Symbol | Byte offset | Line | Value |
| ------ | ----------- | ---- | ----- |
| `J4n` | 13620122 | 6291 | `"var(--conversation-text-inset, 0px)"` |
| `i7h` | 13620164 | 6291 | `"var(--conversation-block-inset, 0px)"` |
| `mEh` | 3301653 | 628 | see below |

```text
function mEh(n,e="detailed"){return n.type!=="tool-call"||eXg(n)?J4n:tXg(n)||nXg(n.toolCall,e)==="block"?i7h:J4n}
```

```text
function nXg(n,e){switch(n.tool.case){case"editToolCall":case"deleteToolCall":return m9r(e)?"text":n.tool.value.result?.result?.case==="success"?"block":"text";case"shellToolCall":return h9r(e)?"text":"block";case"taskToolCall":return"text";default:return"text"}}
```

- **Text inset (`J4n`):** default 0px (CSS var fallback).
- **Block inset (`i7h`):** default 0px — used for block-layout tools (expanded shell/edit/delete).
- **`taskToolCall` steps use text inset** (`nXg` → `"text"`).

---

## 4. Scroll container (`v1` / `ScrollArea`)

### 4.1 Props in `ui-task-tool-call__body`

| Field | Value |
| ----- | ----- |
| Byte offset | 3506198 |
| Line | 639 |

```text
Y=o&&A&&$("div",{className:"ui-task-tool-call__body",children:Re(v1,{maxHeight:300,scrollbarVisibility:"hover",children:[h&&Re("div",{className:"ui-task-tool-call__error",children:[$(gr,{name:"error",size:"sm",color:"red"}),$("span",{children:h})]}),s&&$("div",{className:"ui-task-tool-call__turns",style:{padding:`0 ${l_d}px`},children:k.map(ee=>$(ysv,{turn:ee,renderStep:B},ee.turnIndex))})]})})
```

| Prop | Task body value |
| ---- | ---------------- |
| `maxHeight` | `300` (px) |
| `scrollbarVisibility` | `"hover"` |
| `autoScrollToBottom` | **not set** (default `false`) |
| `scrollTrigger` | **not set** |
| `className` | **not set** on `v1` (only on body/turns wrappers) |

**Contrast — work-group preview `v1`:** byte 3306094, line 628: `maxHeight:r7h` (144), `autoScrollToBottom:!0`, `scrollTrigger:Z`.

### 4.2 `v1` component signature (export `ScrollArea`)

| Field | Value |
| ----- | ----- |
| Byte offset | 13283301 |
| Line | 6030 |

```text
v1=Kb(_(function({children:e,height:t,maxHeight:i,width:r,className:s,viewportClassName:o,style:a,scrollbarVisibility:c=m4v,direction:d="vertical",topFadeSize:m,bottomFadeSize:h,topFadeStartOpacity:f=0,bottomFadeStartOpacity:g=0,autoScrollToBottom:b=!1,scrollTrigger:k,autoScrollPauseTimeout:E=g4v,onScrollStateChange:A,mapVerticalWheelToHorizontal:R=!1,scrollPadding:D=h4v,...M},B){
```

Defaults (same region): `m4v="hover"` (byte 13274918), `h4v=4` (scroll padding).

**Root JSX:** byte 13287200, line 6030.

```text
Re("div",{ref:U,className:Us("ui-scroll-area",Oe&&"ui-scroll-area--masked",s),style:{height:t,maxHeight:i,width:r,...Fe,...ze,...a},"data-scroll-padding":D,"data-visibility":c,"data-direction":d,...M,children:[$("div",{ref:J,className:Us("ui-scroll-area__viewport",o),children:$("div",{ref:W,className:"ui-scroll-area__content",children:e})}),...scrollbars...]})
```

### 4.3 CSS: overscroll, mask

**`.ui-scroll-area` / `__viewport`:** byte 16978524, line 32683.

```text
.ui-scroll-area {
  --scrollbar-size: 6px;
  --scrollbar-inset: 1px;
  --scrollbar-thumb-top-offset: 6px;
  --scroll-area-scroll-padding: 4px;
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template: 1fr/1fr;
}

.ui-scroll-area__viewport {
  grid-area: 1/1;
  min-height: 0;
  max-height: 100%;
  border-radius: inherit;
  overflow-x: hidden;
  overflow-y: auto;
  scroll-padding: var(--scroll-area-scroll-padding) 0;
  overscroll-behavior-x: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: none !important;
  -ms-overflow-style: none;
}
```

**Masked variant (optional fade — not used in `wsv` body call):** byte 16982336, line 32815 — `.ui-scroll-area--masked .ui-scroll-area__viewport { mask-image: linear-gradient(...); }`.

**Scrollbar visibility `hover`:** byte 16981755, line 32815.

```text
.ui-scroll-area[data-visibility=hover] .ui-scroll-area__thumb { opacity: 0; }
.ui-scroll-area[data-visibility=hover]:hover .ui-scroll-area__thumb, ... { opacity: 1; }
```

**Task body does not pass `topFadeSize` / `bottomFadeSize`** → no `--masked` class on task `v1`.

---

## 5. Data shape backing the body

### 5.1 `wsv` prop unpacking

| Field | Value |
| ----- | ----- |
| Byte offset | 3504294 |
| Line | 639 |

```text
function wsv(n){const e=It(48),{toolCall:t,loading:i,subagentConversation:r,renderStep:s}=n,[o,a]=Lt(!1);
```

| Prop | Role |
| ---- | ---- |
| `toolCall` | Title (`gsv`), error (`pRh`), subtitle (`bsv`) |
| `loading` | Status icon, shimmer, subtitle "Generating" |
| `subagentConversation` | `r?.turns ?? []` for body |
| `renderStep` | Wrapped as `B`, fed to `ysv` |

**Turns source:**

```text
b=r?.turns??[]
k=b
k.map(ee=>$(ysv,{turn:ee,renderStep:B},ee.turnIndex))
```

### 5.2 `subagentConversation` shape (inferred from usage)

No standalone TypeScript type in the workbench bundle; shape is implied by:

| Field | Evidence |
| ----- | -------- |
| `turns` | `r?.turns??[]` (byte 3504347) |
| Turn `steps[]` | `nhd`: `.filter(e=>e.type==="loaded").map(e=>e.step)` (byte 3503682) |
| `turnIndex` | React key in `k.map(..., ee.turnIndex)` (byte 3506508) |
| Step types | `_Rh` switch (byte 3540273) |

**Turn padding constant:** `l_d=0` (byte 13898931, line 6312) → turns wrapper `padding: 0 0px`.

**Subtitle from conversation:** `bsv` flatMaps `t.turns.flatMap(o=>nhd(o))` (byte 3503682).

**Proto conversation model (related):** `agent.v1.ConversationState` fields include `turns` (byte 15128644). Subagent streaming via `task_tool_call_delta.interaction_update` (see `cursor-source-extracts.md` §5).

### 5.3 Streaming / re-render drivers

`wsv` memo invalidation includes:

| Dependency | Effect |
| ---------- | ------ |
| `r?.turns` | Body turn list re-renders when conversation grows |
| `i` (`loading`) | Subtitle, icons, shimmer |
| `t` (`toolCall`) | Title, error string |
| Local `o` (expanded) | Body mount/unmount |

**No `autoScrollToBottom` on task body `v1`** — scroll position is not pinned during stream unless user scrolls manually.

---

## 6. Multi mapping (proposal)

### 6.1 Cursor → Multi component map

| Cursor | Multi today | Multi target (Path A) |
| ------ | ----------- | --------------------- |
| `renderStep` / `_Rh` / `ihd` | `ToolCallRenderer` + no step router in task body | **`renderSubagentStep`** + reuse `ToolCallRenderer` for `tool-call` steps |
| `ysv` | None (tray uses flat snapshot rows) | **`SubagentTurnView`** — `data-subagent-turn` + inner step column |
| `Udd` | Tray: manual `turns.map` + `SubagentSnapshotItem` | **`SubagentGroupedSteps`** — gap/padding parity; optional grouping later |
| `v1` / `ScrollArea` | Tray: `overflow-y-auto overscroll-contain` div | **`ScrollArea`** from `@multi/ui/scroll-area` with `max-h-[300px]`, `hideScrollbars`, hover thumbs |
| `subagentConversation.turns` | `ProviderThreadSnapshot.turns` + `WorkLogSubagent.logs` | **Merged transcript model** feeding turns |
| `wsv` body | `TaskToolCall` body in `tool-renderer.tsx` | Expand **`TaskToolCall`** to host turn scroll + step list |

### 6.2 `ToolCallRenderer` vs Cursor dispatch

Multi (`packages/app/src/components/chat/message/tool-renderer.tsx`):

**Props (lines 84–100):**

```tsx
export interface ToolCallRendererProps {
  toolCall: ToolCallModel;
  callId?: string | undefined;
  loading?: boolean | undefined;
  ...
  subagentConversation?: ReactNode;
  renderStep?:
    | ((step: unknown, index: number, parentCallId: string | undefined) => ReactNode)
    | undefined;
  ...
}
```

**Switch cases (lines 256–371):** `awaitToolCall`, `shellToolCall`, `editToolCall`, `deleteToolCall`, `taskToolCall`, `webSearchToolCall`, `webFetchToolCall`, `readToolCall`, `grepToolCall`, `globToolCall`, `mcpToolCall`, `dynamicToolCall`, `imageViewToolCall`, `unknownToolCall`.

| Aspect | Match? |
| ------ | ------ |
| Core tool cases | Partial — Multi has fewer cases; Cursor has `updateTodos`, `ls`, `semSearch`, `readLints`, `getMcpTools`, `reflect` |
| `taskToolCall` → nested body | **Partial** — Multi passes `subagentConversation` ReactNode + broken `renderStep?.(toolCall, 0, callId)` (lines 510–511), not per-step |
| `renderStep` signature | **Misaligned** — Multi uses `(toolCall, index, callId)`; Cursor uses `(step, index, ctx?)` |
| Assistant/thinking steps | **Missing** — no `_Rh` equivalent in task body |

### 6.3 Scroll container in Multi

| Location | Pattern |
| -------- | ------- |
| `subagent-preview-tray.tsx:209` | `overflow-y-auto overscroll-contain` — closest tray behavior |
| `messages-timeline.tsx:437` | timeline scroll |
| `@multi/ui/scroll-area` | shared component — **recommended** for `max-h-[300px]` body (Cursor `v1` parity) |

**New wrapper suggested:** `TaskToolCallBodyScroll` — `ScrollArea` + `max-h-[300px]` + `hideScrollbars` + `className` hook for `data-task-tool-call-body`.

### 6.4 `RenderSubagentStep` — proposed Multi API

```typescript
/** Mirrors Cursor ConversationStep / _Rh step unions (app-level). */
export type SubagentRenderStep =
  | {
      type: "assistant-message";
      message: string;
      status?: "generating" | "completed";
    }
  | {
      type: "tool-call";
      toolCall: ToolCallModel;
      callId?: string;
      status?: "generating" | "completed";
      error?: boolean;
    }
  | {
      type: "thinking";
      thinking: string;
      status?: "generating" | "completed";
    };

export interface RenderSubagentStepContext {
  /** Cursor `ihd` `generating` / `_Rh` loading derivation */
  generating?: boolean;
  /** Only wired in work-group `hEh` today; optional in task body */
  onNestedToolExpand?: (callId: string | undefined) => void;
  expandedToolCallId?: string | undefined;
  conversationDensity?: ToolCallConversationDensity;
  onFileClick?: (path: string) => void;
  onUrlClick?: (url: string) => void;
}

export type RenderSubagentStep = (
  step: SubagentRenderStep,
  index: number,
  ctx?: RenderSubagentStepContext,
) => React.ReactNode;
```

### 6.5 Data consumed from `WorkLogSubagent` + snapshot

| Source | Maps to |
| ------ | ------- |
| `WorkLogSubagent.logs[]` (`WorkLogSubagentLog`) | Live rows: `kind`, `label`, `detail`, `itemId`, `status`, `streamKind` → build/update `SubagentRenderStep` while run is active (`subagent.content.delta` activities) |
| `getProviderThreadSnapshot().turns[]` (`ProviderThreadTurnSnapshot`) | Hydrated transcript: `turn.items[]` (`ProviderThreadSnapshotItem`: `role`, `itemType`, `title`, `detail`) → steps per turn |
| `WorkLogSubagent.title` / `prompt` / `statusLabel` | Card header (`gsv` / `bsv`), not step list |
| `subagent.isActive` | `loading` on card + last-step shimmer |

**Projection pipeline:** merge logs (delta) over snapshot seed on expand; re-render when `subagentPreviewUpdateSignature` / snapshot `turns` reference changes (replace tray polling with activity-driven updates per Path A).

**Default implementation sketch:**

```typescript
function renderSubagentStep(step, index, ctx): ReactNode {
  switch (step.type) {
    case "assistant-message":
      return <ChatMarkdown text={step.message} isStreaming={ctx?.generating} />;
    case "thinking":
      return <ThinkingBlock ... />;
    case "tool-call":
      return (
        <ToolCallRenderer
          toolCall={step.toolCall}
          callId={step.callId}
          loading={step.status === "generating"}
          renderStep={renderSubagentStep}
          onNestedToolExpand={...}
        />
      );
  }
}
```

---

## Evidence index

| Claim | Byte | Line |
| ----- | ---- | ---- |
| `wsv` / `ysv` / `Udd` / `nhd` | 3503682–3506508 | 639 |
| `renderStep` 3-arg wrapper `B` | 3504886 | 639 |
| `_Rh` / `ihd` | 3540273–3542763 | 644 |
| `vRh` + 17 tool cases | 3521657–3526461 | 644 |
| `Wsv` + `V4` markdown | 3539874, 3242333 | 644, 620 |
| `J4n` / `i7h` / `mEh` | 13620122, 3301653 | 6291, 628 |
| `wsv` body `v1` | 3506198 | 639 |
| `v1` ScrollArea | 13283301–13287200 | 6030 |
| `.ui-scroll-area*` CSS | 16978524–16982336 | 32683–32815 |
| `l_d=0` | 13898931 | 6312 |
| Multi `ToolCallRenderer` | `tool-renderer.tsx` | 84–371 |
| Multi `WorkLogSubagent` | `session-logic.ts` | 50–81 |
| Multi `ProviderThreadSnapshot` | `provider.ts` | 105–117 |
