# Path A — Member 3: Task card surfaces, subagent presentation, click site

Council slice: **current Multi presentation** for the task tool (`TaskToolCall`), the subagent surface inside it (`SubagentStatusSurface` / `SubagentStatusRow`), and the `SubagentStatusRow` click site. Read-only audit for Path A inline subagent transcript inside the task card body.

Sources read end-to-end 2026-05-26:

- `packages/app/src/components/chat/message/tool-renderer.tsx`
- `packages/app/src/components/chat/message/tool-message.tsx`
- `packages/app/src/components/chat/timeline/messages-timeline.tsx`
- `packages/app/src/styles/tool-call.css`
- `packages/app/src/components/chat/composer/subagent-preview-tray.tsx` (migration targets)
- Reference: `.cursor/research/cursor-task-tool-card.md`, `.cursor/research/cursor-subagent-click-flow.md`, `.cursor/research/multi-current-state.md`

---

## 1. `TaskToolCall` JSX (verbatim)

File: `packages/app/src/components/chat/message/tool-renderer.tsx`

### Full component (L417–515)

```417:515:packages/app/src/components/chat/message/tool-renderer.tsx
function TaskToolCall({
  action,
  details,
  loading,
  hasError,
  subagentConversation,
  renderStep,
  toolCall,
  callId,
  defaultExpanded,
  onNestedToolExpand,
  showIcon,
}: {
  action: string;
  details: string;
  loading: boolean;
  hasError: boolean;
  subagentConversation: ReactNode;
  renderStep:
    | ((step: unknown, index: number, parentCallId: string | undefined) => ReactNode)
    | undefined;
  toolCall: ToolCallModel;
  callId: string | undefined;
  defaultExpanded: boolean;
  onNestedToolExpand: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  showIcon: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const hasBody = Boolean(subagentConversation) || Boolean(renderStep);
  const statusIcon = showIcon ? (
    <span className="inline-flex shrink-0 items-center justify-center text-multi-icon-tertiary">
      {loading ? (
        <IconClock className="tool-call-shimmer size-3.5" />
      ) : hasError ? (
        <IconToolbox className="size-3.5 text-multi-fg-red-primary" />
      ) : (
        <IconRobot className="size-3.5" />
      )}
    </span>
  ) : null;
  const titleArea = (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden">
      <span className={toolCallLineActionVariants({ loading })}>{action}</span>
      {details ? (
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary">
          {details}
        </span>
      ) : null}
    </span>
  );
  const toggleExpanded = () => {
    if (!hasBody) return;
    setIsExpanded((current) => {
      const next = !current;
      onNestedToolExpand?.(callId, next);
      return next;
    });
  };

  return (
    <div
      className="group/task-tool-call min-w-0 max-w-full text-multi-fg-secondary"
      data-task-tool-call=""
      data-status={hasError ? "error" : loading ? "running" : "completed"}
      data-expanded={isExpanded ? "true" : "false"}
    >
      {hasBody ? (
        <button
          type="button"
          className="inline-flex min-h-6 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden"
          aria-expanded={isExpanded}
          onClick={toggleExpanded}
          data-task-tool-call-header=""
        >
          {statusIcon}
          {titleArea}
          <IconChevronRightMedium
            className={cn(
              "size-3 shrink-0 text-multi-icon-tertiary opacity-0 transition-[opacity,transform] duration-(--motion-duration-collapsible) ease-out",
              "group-hover/task-tool-call:opacity-100 group-focus-within/task-tool-call:opacity-100",
              isExpanded && "rotate-90 opacity-100",
            )}
            data-task-tool-call-chevron=""
          />
        </button>
      ) : (
        <div className="inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden">
          {statusIcon}
          {titleArea}
        </div>
      )}
      {isExpanded && hasBody ? (
        <div className="mt-1 min-w-0 max-w-full" data-task-tool-call-body="">
          {subagentConversation}
          {renderStep?.(toolCall, 0, callId)}
        </div>
      ) : null}
    </div>
  );
}
```

### Structure summary

| Region | Element | Hook / class |
|--------|---------|--------------|
| **Root** | `<div>` | `data-task-tool-call=""`, `data-status`, `data-expanded` |
| **Header** | `<button>` when `hasBody`, else static `<div>` | `data-task-tool-call-header=""` on button only |
| **Body** | Conditional `<div>` when `isExpanded && hasBody` | **`data-task-tool-call-body=""`** — inline subagent transcript mount site |

### `subagentConversation` / `WorkLogSubagent[]` flow

`TaskToolCall` receives `subagentConversation: ReactNode` — **not** raw `WorkLogSubagent[]`. Conversion happens upstream in `ToolCallMessage`:

```54:78:packages/app/src/components/chat/message/tool-message.tsx
  const toolCall = toToolCall(workEntry, projectRoot);
  const hasSubagents = subagents.length > 0;
  const subagentStatusSurface = hasSubagents ? (
    <SubagentStatusSurface
      activeThreadId={activeThreadId}
      environmentId={environmentId}
      projectRoot={projectRoot}
      subagentDetailsEnabled={subagentDetailsEnabled}
      subagents={subagents}
    />
  ) : null;
  const renderSubagentsInToolBody = hasSubagents && toolCall.tool.case === "taskToolCall";

  return (
    <div className="w-full min-w-0 max-w-full">
      <ToolCallRenderer
        toolCall={toolCall}
        callId={workEntry.toolCallId ?? workEntry.id}
        loading={isLoading}
        startedAtMs={Date.parse(workEntry.createdAt)}
        hasError={status === "error"}
        subagentConversation={renderSubagentsInToolBody ? subagentStatusSurface : undefined}
        defaultExpanded={renderSubagentsInToolBody}
        conversationDensity="minimal"
      />
```

- `workEntry.subagents ?? []` is read at `tool-message.tsx:44`.
- For `taskToolCall` only, `SubagentStatusSurface` (status rows) is passed as `subagentConversation` into `TaskToolCall` body.
- **`renderStep` is never passed** from `ToolCallMessage` today — always `undefined` at the `ToolCallRenderer` call site (`tool-message.tsx:69–78`).
- `ToolCallRenderer` forwards both props to `TaskToolCall` at `tool-renderer.tsx:306–320`.

Dispatch into `TaskToolCall`:

```306:320:packages/app/src/components/chat/message/tool-renderer.tsx
    case "taskToolCall":
      return (
        <TaskToolCall
          action={displayState.action}
          details={displayState.details}
          loading={loading}
          hasError={hasError}
          subagentConversation={subagentConversation}
          renderStep={renderStep}
          toolCall={toolCall}
          callId={callId}
          defaultExpanded={defaultExpanded}
          onNestedToolExpand={onNestedToolExpand}
          showIcon={conversationDensity === "verbose"}
        />
      );
```

### Inline body mount point

Path A transcript turns should replace or wrap content inside:

```508:512:packages/app/src/components/chat/message/tool-renderer.tsx
      {isExpanded && hasBody ? (
        <div className="mt-1 min-w-0 max-w-full" data-task-tool-call-body="">
          {subagentConversation}
          {renderStep?.(toolCall, 0, callId)}
```

Today the body renders **only** `SubagentStatusSurface` (clickable status rows) plus an unused `renderStep` slot.

---

## 2. `SubagentStatusSurface` JSX (verbatim)

File: `packages/app/src/components/chat/message/tool-message.tsx`

### Component (L105–147)

```105:147:packages/app/src/components/chat/message/tool-message.tsx
function SubagentStatusSurface({
  activeThreadId,
  environmentId,
  projectRoot,
  subagentDetailsEnabled,
  subagents,
}: {
  activeThreadId: ThreadId;
  environmentId: EnvironmentId;
  projectRoot: string | undefined;
  subagentDetailsEnabled: boolean;
  subagents: ReadonlyArray<WorkLogSubagent>;
}) {
  const openPreviewKey = useSubagentPreviewStore((state) => state.preview?.key ?? null);
  const hasOpenPreview = subagents.some(
    (subagent) => subagentPreviewKey(subagent) === openPreviewKey,
  );

  return (
    <div
      data-subagent-status-container=""
      data-subagent-open={hasOpenPreview ? "" : undefined}
      className="mt-1 w-full min-w-0 max-w-[85%] text-[14px]/5"
    >
      <div
        data-subagent-status-stack=""
        className="flex w-full min-w-0 flex-col items-start pt-0.5"
      >
        {subagents.map((subagent) => (
          <SubagentStatusRow
            key={subagentPreviewKey(subagent)}
            activeThreadId={activeThreadId}
            environmentId={environmentId}
            isPreviewOpen={openPreviewKey === subagentPreviewKey(subagent)}
            projectRoot={projectRoot}
            subagent={subagent}
            subagentDetailsEnabled={subagentDetailsEnabled}
          />
        ))}
      </div>
    </div>
  );
}
```

### Props received

| Prop | Type | Source |
|------|------|--------|
| `activeThreadId` | `ThreadId` | `ToolCallMessage` prop |
| `environmentId` | `EnvironmentId` | `ToolCallMessage` prop |
| `projectRoot` | `string \| undefined` | `ToolCallMessage` prop |
| `subagentDetailsEnabled` | `boolean` | `ToolCallMessage` prop (default `true`) |
| `subagents` | `ReadonlyArray<WorkLogSubagent>` | `workEntry.subagents` |

### What it renders today

Inside the task card body (when `taskToolCall` + subagents): a vertical stack of **`SubagentStatusRow`** buttons — status indicator, name, model badge, latest update, usage, chevron. **No transcript turns.** Rows open the composer preview tray via `openPreview`.

### Mount call sites

**One definition**, **two render paths** in `ToolCallMessage`:

1. **Inside task card body** — `subagentConversation` when `renderSubagentsInToolBody` (`tool-message.tsx:56–64`, `75`).
2. **Below non-task tool rows** — sibling after `ToolCallRenderer` when `hasSubagents && !renderSubagentsInToolBody` (`tool-message.tsx:79`).

No other files import `SubagentStatusSurface` (grep: only `tool-message.tsx`).

---

## 3. `SubagentStatusRow` JSX + click handler

### Click handler — `openPreview` today (L177–188)

```177:188:packages/app/src/components/chat/message/tool-message.tsx
  const handleOpenPreview = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!hasDetails) {
      return;
    }
    openPreview({
      key,
      activeThreadId,
      environmentId,
      projectRoot,
      subagent,
    });
  };
```

- `openPreview` from `useSubagentPreviewStore` (`tool-message.tsx:164`).
- Store implementation: `subagent-preview-store.ts:115` — `openPreview: (selection) => set({ preview: selection })`.
- Opens composer-adjacent `SubagentPreviewTrayStack`, not inline task card expansion.

### Full row JSX (L200–265)

```200:265:packages/app/src/components/chat/message/tool-message.tsx
  return (
    <>
      {previewUpdateSync}
      <button
        type="button"
        className={cn(
          "group/subagent-row inline-flex min-h-6 w-fit max-w-full min-w-0 items-center gap-1 overflow-hidden",
          "border-0 bg-transparent p-0 text-left text-detail text-multi-fg-secondary",
          hasDetails &&
            "cursor-pointer hover:text-multi-fg-primary focus-visible:text-multi-fg-primary focus-visible:outline-none",
          isPreviewOpen && hasDetails && "text-multi-fg-primary",
        )}
        data-subagent-row=""
        data-subagent-state={rowState}
        data-subagent-provider-thread-id={hasProviderThread ? providerThreadId : undefined}
        disabled={!hasDetails}
        aria-label={hasDetails ? `Open ${title} details` : undefined}
        aria-pressed={hasDetails ? isPreviewOpen : undefined}
        onClick={handleOpenPreview}
        onKeyDown={handleKeyDown}
      >
        <SubagentStatusIndicator subagent={subagent} />
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 overflow-hidden">
          <span
            data-subagent-name=""
            className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {title}
          </span>
          {subagent.model ? (
            <span className="shrink-0 rounded border border-multi-stroke-tertiary px-1 text-caption text-multi-fg-tertiary">
              {subagent.model}
            </span>
          ) : null}
          {statusText ? (
            <span
              data-subagent-task=""
              className={cn(
                "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary",
                subagent.isActive && "tool-call-shimmer",
              )}
            >
              {statusText}
            </span>
          ) : null}
          {subagent.usedTokens !== undefined && subagent.usedTokens > 0 ? (
            <span className="shrink-0 text-caption text-multi-fg-tertiary tabular-nums">
              {formatSubagentUsageLabel(subagent)}
            </span>
          ) : null}
        </span>
        {hasDetails ? (
          <span
            className={cn(
              "ml-1 inline-flex shrink-0 opacity-0 transition-opacity duration-100",
              "group-hover/subagent-row:opacity-100 group-focus-visible/subagent-row:opacity-100",
              isPreviewOpen && "opacity-100",
            )}
            data-subagent-open=""
            aria-hidden="true"
          >
            <IconChevronRightMedium className="size-3" />
          </span>
        ) : null}
      </button>
    </>
  );
```

### Styling to preserve (status indicator + label)

**Status indicator** — `SubagentStatusIndicator` (`tool-message.tsx:283–305`):

- Active: `IconClock` + `tool-call-shimmer`, `text-multi-icon-accent-primary`
- Failed: `size-1.5 rounded-full bg-multi-fg-red-primary`
- Completed: `IconRobot`, `text-multi-icon-tertiary`

**Label cluster** — keep:

- `[data-subagent-name]` — title (`subagent.title ?? nickname ?? role ?? "Subagent"`)
- Model badge (optional)
- `[data-subagent-task]` — `latestUpdate ?? statusLabel` with shimmer when active
- Usage caption (optional)
- Chevron on hover / when preview open

**CSS hooks** (not in `tool-call.css`):

```560:568:packages/app/src/styles/conversation.css
[data-subagent-status-container] [data-subagent-task].tool-call-shimmer {
  color: var(--multi-fg-tertiary);
  -webkit-text-fill-color: var(--multi-fg-tertiary);
}

[data-subagent-status-container]:is(:hover, :focus-within) [data-subagent-task].tool-call-shimmer,
[data-subagent-row]:is(:hover, :focus-visible) [data-subagent-task].tool-call-shimmer {
  color: var(--multi-fg-primary);
  -webkit-text-fill-color: var(--multi-fg-primary);
}
```

### `defaultExpanded={true}` — owner and quote

**Owner:** `ToolCallMessage` passes it to `ToolCallRenderer` when subagents render inside a task tool body.

```65:77:packages/app/src/components/chat/message/tool-message.tsx
  const renderSubagentsInToolBody = hasSubagents && toolCall.tool.case === "taskToolCall";

  return (
    <div className="w-full min-w-0 max-w-full">
      <ToolCallRenderer
        toolCall={toolCall}
        callId={workEntry.toolCallId ?? workEntry.id}
        loading={isLoading}
        startedAtMs={Date.parse(workEntry.createdAt)}
        hasError={status === "error"}
        subagentConversation={renderSubagentsInToolBody ? subagentStatusSurface : undefined}
        defaultExpanded={renderSubagentsInToolBody}
        conversationDensity="minimal"
      />
```

**Consumer:** `TaskToolCall` initializes local expand state from it:

```444:444:packages/app/src/components/chat/message/tool-renderer.tsx
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
```

**Gap (per click-flow audit):** card starts expanded (`defaultExpanded={true}`) but row click calls `openPreview` instead of toggling/using the inline body transcript.

---

## 4. `ToolCallRenderer` signature + dispatch

### Props interface (L84–100)

```84:100:packages/app/src/components/chat/message/tool-renderer.tsx
export interface ToolCallRendererProps {
  toolCall: ToolCallModel;
  callId?: string | undefined;
  loading?: boolean | undefined;
  startedAtMs?: number | undefined;
  hasError?: boolean | undefined;
  approval?: ToolCallApproval | undefined;
  subagentConversation?: ReactNode;
  renderStep?:
    | ((step: unknown, index: number, parentCallId: string | undefined) => ReactNode)
    | undefined;
  onFileClick?: ((path: string) => void) | undefined;
  onUrlClick?: ((url: string) => void) | undefined;
  onNestedToolExpand?: ((callId: string | undefined, expanded: boolean) => void) | undefined;
  defaultExpanded?: boolean | undefined;
  conversationDensity?: ToolCallConversationDensity | undefined;
}
```

### Component signature + dispatch table (L225–372)

```225:372:packages/app/src/components/chat/message/tool-renderer.tsx
export const ToolCallRenderer = memo(function ToolCallRenderer({
  toolCall,
  callId,
  loading = false,
  startedAtMs,
  hasError = false,
  approval,
  subagentConversation,
  renderStep,
  onFileClick,
  onUrlClick,
  onNestedToolExpand,
  defaultExpanded = false,
  conversationDensity = "minimal",
}: ToolCallRendererProps) {
  // ... artifact extraction ...
  switch (toolCall.tool.case) {
    case "awaitToolCall":
      return ( <ToolCallLine ... /> );
    case "shellToolCall":
      return ( <ShellToolCall ... /> );
    case "editToolCall":
    case "deleteToolCall":
      return ( <EditToolCall ... /> );
    case "taskToolCall":
      return ( <TaskToolCall ... subagentConversation={subagentConversation} renderStep={renderStep} ... /> );
    case "webSearchToolCall":
    case "webFetchToolCall":
      return ( <ToolCallLine ... /> );
    case "readToolCall":
    case "grepToolCall":
    case "globToolCall":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "imageViewToolCall":
    case "unknownToolCall":
      return ( <ExpandableToolMetadataLine ... /> );
  }
});
```

### Single arbitrary tool call given a model?

**Yes.** `ToolCallRenderer` accepts one `ToolCallModel` + runtime flags and dispatches by `toolCall.tool.case`. This is Multi's equivalent of Cursor's compact line `q$` and the nested hub `vRh` — a **single entry point** for rendering any tool kind from a normalized model.

Path A requires wiring `renderStep` from the timeline so nested subagent steps recurse through this same renderer (mirror Cursor passing `renderStep` into `wsv` / `ysv` / `Udd`).

### Supported tool kinds (`ToolCase`, L45–59)

| Multi `ToolCase` | Component | Cursor overlap (17-case hub) |
|------------------|-----------|------------------------------|
| `awaitToolCall` | `ToolCallLine` | await |
| `shellToolCall` | `ShellToolCall` | shell |
| `editToolCall` | `EditToolCall` | edit |
| `deleteToolCall` | `EditToolCall` (isDelete) | delete |
| `taskToolCall` | `TaskToolCall` | task |
| `webSearchToolCall` | `ToolCallLine` | web search |
| `webFetchToolCall` | `ToolCallLine` | web fetch |
| `readToolCall` | `ExpandableToolMetadataLine` | read |
| `grepToolCall` | `ExpandableToolMetadataLine` | grep |
| `globToolCall` | `ExpandableToolMetadataLine` | glob |
| `mcpToolCall` | `ExpandableToolMetadataLine` | MCP |
| `dynamicToolCall` | `ExpandableToolMetadataLine` | dynamic |
| `imageViewToolCall` | `ExpandableToolMetadataLine` | image view |
| `unknownToolCall` | `ExpandableToolMetadataLine` | unknown / fallback |

**14 cases** in Multi's switch; Cursor's `vRh` hub covers a similar set with task/shell/edit as dedicated card/accordion components and the rest as `q$` lines.

---

## 5. Work-group routing to `ToolCallMessage`

### Expanded work group (L903–916)

```903:916:packages/app/src/components/chat/timeline/messages-timeline.tsx
      {expanded ? (
        <div className="flex min-w-0 max-w-full flex-col gap-(--chat-timeline-step-gap)">
          {!isCommandGroup ? <WorkGroupSummaryLine summary={summary} /> : null}
          {row.groupedEntries.map((workEntry) => (
            <ToolCallMessage
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              projectRoot={projectRoot}
              activeThreadId={activeThreadId}
              environmentId={activeThreadEnvironmentId}
              subagentDetailsEnabled
            />
          ))}
        </div>
      ) : isRunning ? (
```

### Running preview pane (L1014–1022)

```1014:1022:packages/app/src/components/chat/timeline/messages-timeline.tsx
      {previewEntries.map((workEntry) => (
        <ToolCallMessage
          key={`work-preview-row:${workEntry.id}`}
          workEntry={workEntry}
          projectRoot={projectRoot}
          activeThreadId={activeThreadId}
          environmentId={activeThreadEnvironmentId}
          subagentDetailsEnabled
        />
      ))}
```

### Is `WorkLogEntry.subagents` passed through?

**Not as an explicit prop.** Timeline passes whole `workEntry`; subagents are read inside `ToolCallMessage`:

```44:44:packages/app/src/components/chat/message/tool-message.tsx
  const subagents = workEntry.subagents ?? [];
```

`WorkLogEntry.subagents` is populated in `session-logic.ts` via `extractWorkLogSubagents` / `mergeSubagents` / `applySubagentDetails` (see `multi-current-state.md`).

Timeline props to `ToolCallMessage`: `workEntry`, `projectRoot`, `activeThreadId`, `environmentId`, `subagentDetailsEnabled` only — **no** `renderStep`, **no** `onFileClick`, **no** `onNestedToolExpand`.

### Prop chain (timeline → task card)

```text
messages-timeline.tsx
  WorkGroupSection / WorkGroupPreview
    → ToolCallMessage(workEntry, …)                    [tool-message.tsx:35–82]
      → workEntry.subagents                            [tool-message.tsx:44]
      → toToolCall(workEntry) → ToolCallModel          [tool-message.tsx:54, 337–378]
      → SubagentStatusSurface(subagents)               [tool-message.tsx:56–64]
      → ToolCallRenderer(
           toolCall,
           subagentConversation = surface | undefined,  [tool-message.tsx:75]
           defaultExpanded = renderSubagentsInToolBody,  [tool-message.tsx:76]
           renderStep = undefined                       [not passed]
         )                                              [tool-message.tsx:69–78]
        → case "taskToolCall": TaskToolCall(            [tool-renderer.tsx:306–320]
             subagentConversation,
             renderStep,
             defaultExpanded,
           )
          → data-task-tool-call-body                    [tool-renderer.tsx:508–512]
               {subagentConversation}  ← SubagentStatusSurface today
```

---

## 6. Proposed rewiring — concrete JSX for `TaskToolCall` body

Goal: Cursor `wsv` parity — expanded body shows transcript turns (user / assistant / tool / command), not tray-only snapshot. Reuse tray item renderers; recurse nested tools through `ToolCallRenderer`.

### 6.1 New body shell inside `TaskToolCall`

Replace L508–512 with a scroll-capped turn list (mirror Cursor `v1 maxHeight:300`):

```tsx
{isExpanded && hasBody ? (
  <div data-task-tool-call-body="">
    {hasError ? (
      <div data-task-tool-call-error="" className="flex items-start gap-2 px-3 py-2 text-body text-multi-fg-red-primary">
        {/* error string from tool result */}
      </div>
    ) : null}
    <div
      data-task-tool-call-turns=""
      className="flex max-h-[300px] min-w-0 flex-col gap-(--chat-timeline-step-gap) overflow-y-auto overscroll-contain"
      style={{ padding: "0 0px" }} /* l_d = 0 per member-1 / cursor-subagent-click-flow.md:137 */
    >
      <TaskSubagentTranscript
        subagents={subagents}
        activeThreadId={activeThreadId}
        environmentId={environmentId}
        projectRoot={projectRoot}
        isStreaming={loading}
        renderStep={renderStep}
        parentCallId={callId}
      />
    </div>
  </div>
) : null}
```

`TaskSubagentTranscript` is new; props would be threaded from `ToolCallMessage` through `ToolCallRenderer` (extend props or pass transcript node instead of status surface).

### 6.2 User message item

Reuse from `subagent-preview-tray.tsx:315–321` + `337–351`:

```tsx
function TaskTranscriptUserItem({
  detail,
  title,
}: {
  detail: string;
  title: string | undefined;
}) {
  return (
    <div data-task-transcript-user="" className="min-w-0 pl-3 select-text">
      <ChatMessageBubble
        role="user"
        body={<SubagentUserMessageBody detail={detail} title={title} />}
      />
    </div>
  );
}
```

Existing `SubagentUserMessageBody` (`subagent-preview-tray.tsx:337–351`) and `ChatMessageBubble` import stay as-is.

### 6.3 Assistant message item

Reuse from `subagent-preview-tray.tsx:307–312`:

```tsx
function TaskTranscriptAssistantItem({
  detail,
  projectRoot,
  isStreaming,
}: {
  detail: string;
  projectRoot: string | undefined;
  isStreaming: boolean;
}) {
  return (
    <div data-task-transcript-assistant="" className="min-w-0 pl-3 select-text">
      <ChatMarkdown cwd={projectRoot} isStreaming={isStreaming} text={detail} />
    </div>
  );
}
```

### 6.4 Tool call item — recurse via `ToolCallRenderer`

Replace tray's `SubagentActivityLine` fallback for `role === "tool"` with main renderer when snapshot `data` carries a `ToolCallModel`:

```tsx
function TaskTranscriptToolItem({
  item,
  projectRoot,
  isStreaming,
  renderStep,
  parentCallId,
}: {
  item: ProviderThreadSnapshotItem;
  projectRoot: string | undefined;
  isStreaming: boolean;
  renderStep: ToolCallRendererProps["renderStep"];
  parentCallId: string | undefined;
}) {
  const toolCall = snapshotItemToToolCallModel(item, projectRoot);
  if (toolCall) {
    return (
      <div data-task-transcript-tool="" className="min-w-0 pl-3">
        <ToolCallRenderer
          toolCall={toolCall}
          callId={item.id}
          loading={isStreaming}
          renderStep={renderStep}
          onNestedToolExpand={undefined}
          conversationDensity="minimal"
        />
      </div>
    );
  }
  /* fallback: existing SubagentActivityLine path */
  return (
    <div data-task-transcript-tool="" className="min-w-0 pl-3">
      <SubagentActivityLine
        action={item.title ?? formatSnapshotTypeLabel(item.itemType)}
        detail={item.detail}
        loading={isStreaming}
      />
    </div>
  );
}
```

Or wire `renderStep` from timeline:

```tsx
// messages-timeline.tsx — pass to ToolCallMessage
renderStep={(step, index, parentCallId) => (
  <ToolCallRenderer
    toolCall={step as ToolCallModel}
    callId={parentCallId}
    renderStep={renderStep}
    conversationDensity="minimal"
  />
)}
```

### 6.5 Command execution item

When `item.itemType === "command_execution"` or log `streamKind === "command_output"`, use `ShellToolCall` via renderer (`shellToolCall` case) or inline:

```tsx
function TaskTranscriptCommandItem({
  command,
  output,
  loading,
  callId,
}: {
  command: string;
  output: string | null;
  loading: boolean;
  callId: string | undefined;
}) {
  return (
    <div data-task-transcript-command="" className="min-w-0 pl-3">
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "shellToolCall",
            value: { action: "Ran command", details: command, command, output },
          },
        }}
        callId={callId}
        loading={loading}
        defaultExpanded={loading}
        conversationDensity="minimal"
      />
    </div>
  );
}
```

Live path: map `WorkLogSubagentLog` with `itemType: "command_execution"` the same way tray maps logs to `SubagentActivityLine` (`subagent-preview-tray.tsx:223–230`).

### 6.6 Empty state

Match tray tertiary copy; use 13px tertiary (`text-detail` ≈ 12px, `text-body` ≈ 12px at default — prefer explicit conversation size):

```tsx
function TaskTranscriptEmptyState() {
  return (
    <div
      data-task-transcript-empty=""
      className="py-1 text-[13px] leading-5 text-multi-fg-tertiary"
    >
      No transcript yet
    </div>
  );
}
```

Tray equivalent: `subagent-preview-tray.tsx:234–236` — `"No thread content yet."` with `text-detail text-multi-fg-tertiary`.

### 6.7 Components to migrate from `subagent-preview-tray.tsx`

| Tray symbol | Lines | Migrate into task body as |
|-------------|-------|---------------------------|
| `SubagentSnapshotSection` | 241–294 | Turn list + loading/error states |
| `SubagentSnapshotItem` | 296–335 | Per-item dispatch (user / assistant / tool) |
| `SubagentUserMessageBody` | 337–351 | User bubble body |
| `SubagentActivityLine` | 354–378 | Tool/command fallback lines |
| `SubagentPreviewBody` snapshot hook | 145–204 | Inline snapshot fetch OR replace with streamed `subagent.logs` + coalesced deltas |
| `deriveVisibleSubagentLogs` | 397–402 | Running log tail while canonical transcript loads |

**Lift `SubagentSnapshotItem` logic** into a shared module (e.g. `subagent-transcript-items.tsx`) consumed by both tray (deprecated) and `TaskToolCall` body.

### 6.8 `SubagentStatusRow` click rewiring

Move row into **task card header subtitle area** (Cursor `bsv`) or keep as first body row but change handler:

```tsx
const handleRowClick = (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  if (!hasDetails) return;
  onToggleExpanded?.(); // parent TaskToolCall setIsExpanded — NOT openPreview
};
```

Remove `openPreview` / `isPreviewOpen` / `SubagentPreviewUpdateSync` from inline path.

---

## 7. CSS delta — `[data-task-tool-call*]` rules

File: `packages/app/src/styles/tool-call.css`. All `[data-task-tool-call*]` selectors:

### Verbatim rules

```41:47:packages/app/src/styles/tool-call.css
[data-task-tool-call] {
  border-radius: var(--multi-radius-card);
  border: 1px solid var(--multi-stroke-tertiary);
  background: var(--multi-bg-quinary);
  overflow: hidden;
  font-size: var(--multi-text-body);
}
```

```49:63:packages/app/src/styles/tool-call.css
[data-task-tool-call-header] {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  outline: none;
}
```

```65:67:packages/app/src/styles/tool-call.css
[data-task-tool-call-body] {
  padding: 0 10px 8px;
}
```

```73:81:packages/app/src/styles/tool-call.css
[data-task-tool-call-chevron] {
  transition:
    transform var(--motion-duration-collapsible, 100ms) var(--motion-easing-standard),
    opacity var(--motion-duration-hover, 100ms) var(--motion-easing-standard);
}

[data-task-tool-call][data-expanded="true"] [data-task-tool-call-chevron] {
  opacity: 1;
}
```

Related margin reset (task card in assistant bubble):

```113:116:packages/app/src/styles/tool-call.css
[data-timeline-row-kind="message"][data-message-role="assistant"]
  :is([data-shell-tool-call], [data-task-tool-call], [data-tool-call-line]) {
  margin-block: 0;
}
```

### KEEP / RETOKEN / NEW map

| Rule | Verdict | Notes |
|------|---------|-------|
| `[data-task-tool-call]` border-radius | **RETOKEN** | → `var(--conversation-surface-border-radius, var(--multi-radius-card))` per cursor-task-tool-card.md:473 |
| `[data-task-tool-call]` border | **RETOKEN** | → `1px solid var(--card-border-color, var(--multi-stroke-secondary))` |
| `[data-task-tool-call]` background | **RETOKEN** | → `var(--cursor-bg-tertiary, var(--multi-bg-tertiary))` |
| `[data-task-tool-call]` overflow | **KEEP** | Matches Cursor |
| `[data-task-tool-call]` font-size | **KEEP** | Already conversation body size |
| `[data-task-tool-call-header]` layout | **RETOKEN** | `inline-flex` + `align-items: center` → `flex` + `align-items: flex-start`; padding `6px` → `8px`; add `min-height: 36px` |
| `[data-task-tool-call-header]` hover | **NEW** | `[data-task-tool-call-header]:hover { background: var(--multi-bg-secondary); }` |
| `[data-task-tool-call-body]` | **RETOKEN** | Replace padding with Cursor body rule (below) |
| `[data-task-tool-call-chevron]` transition | **RETOKEN** | Drop opacity from transition; transform only 100ms |
| `[data-task-tool-call][data-expanded="true"] [data-task-tool-call-chevron]` | **KEEP** | Expanded opacity |
| Assistant bubble margin reset | **KEEP** | Unrelated to Path A body |

### Required body rule (Path A)

```css
[data-task-tool-call-body] {
  border-top: 1px solid var(--multi-stroke-secondary);
  padding: 6px 0;
}
```

Remove `padding: 0 10px 8px` and JSX `mt-1` on body (`tool-renderer.tsx:509`) so divider + padding come from CSS only.

### Inner indent for transcript turns

Cursor: `style={{ padding: \`0 ${l_d}px\` }}` on `ui-task-tool-call__turns`. Member-1 extract: **`l_d = 0`** (`.cursor/research/cursor-subagent-click-flow.md:137`) → **`padding: 0 0px`**. Per-turn indent uses step renderer `paddingInline: mEh(M.step, g)` in Cursor; Multi should use **`pl-3`** (12px) on user/assistant/tool rows in JSX above, or:

```css
[data-task-tool-call-turns] > [data-task-transcript-user],
[data-task-tool-call-turns] > [data-task-transcript-assistant],
[data-task-tool-call-turns] > [data-task-transcript-tool],
[data-task-tool-call-turns] > [data-task-transcript-command] {
  padding-inline: 0; /* outer turns wrapper l_d=0; inner pl-3 on items */
}
```

### NEW rules for transcript body (member 3 proposal)

```css
[data-task-tool-call-turns] {
  max-height: 300px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

[data-task-tool-call-error] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  color: var(--multi-fg-red-primary);
  font-size: var(--multi-text-body);
  line-height: 20px;
}

[data-task-transcript-empty] {
  padding: 4px 12px;
  font-size: 13px;
  line-height: 20px;
  color: var(--multi-fg-tertiary);
}
```

---

## 8. CSS for `SubagentStatusRow`

### Current rules

**No dedicated `[data-subagent-row]` block in `tool-call.css`.** Row styling is Tailwind on the button (`tool-message.tsx:205–211`):

- `inline-flex min-h-6 … text-detail text-multi-fg-secondary`
- Hover/focus primary text when `hasDetails`
- `data-subagent-state`, `data-subagent-provider-thread-id` for diagnostics

**Container** (`SubagentStatusSurface`): `mt-1 max-w-[85%] text-[14px]/5` — may conflict with card body `font-size: var(--multi-text-body)` (~12px default).

**Shimmer overrides** — `conversation.css:560–568` (quoted in §3).

**Chevron** — `conversation.css:577–579` reduced-motion only for `[data-subagent-open] svg`.

### Path A behavior

| Today | Path A |
|-------|--------|
| Row is clickable `<button>` opening composer tray | Row remains clickable header element (indicator + name + status text) |
| `onClick → openPreview()` | `onClick → toggle parent task card expanded` (or select subagent when multi-subagent) |
| `aria-pressed={isPreviewOpen}` | `aria-expanded={parentExpanded}` |
| Chevron indicates tray open | Chevron rotates with `[data-task-tool-call][data-expanded="true"]` on **card** header |

Keep **`SubagentStatusIndicator`**, **`[data-subagent-name]`**, **`[data-subagent-task]`** markup and shimmer CSS. Remove tray-specific `data-subagent-open` pressed state and `SubagentPreviewUpdateSync`.

When transcript is inline, nested subagent row under Cursor uses `padding: 2px 0 2px 12px` (click-flow audit §1-B) — align Multi row to **`pl-3`** inside `[data-task-tool-call-body]` instead of `max-w-[85%]` floating stack.

---

## Summary table — today vs Path A

| Concern | Today | Path A target |
|---------|-------|---------------|
| Body content | `SubagentStatusSurface` rows only | Transcript turns via migrated tray items + `ToolCallRenderer` recurse |
| Row click | `openPreview` → composer tray | Toggle / focus inline `[data-task-tool-call-body]` |
| `renderStep` | Never passed | Timeline → `ToolCallMessage` → `ToolCallRenderer` → nested tools |
| `defaultExpanded` | `true` for task+subagents | Keep; body shows transcript not just status rows |
| Data source | Tray polls snapshot 2500ms | Stream `workEntry.subagents` logs + snapshot reconcile |
| CSS body | `padding: 0 10px 8px`, no border-top | `border-top` + `padding: 6px 0`, scroll cap 300px |

---

## Evidence index

| Claim | Citation |
|-------|----------|
| TaskToolCall structure | `tool-renderer.tsx:417–515` |
| subagentConversation wiring | `tool-message.tsx:44–79`, `tool-renderer.tsx:306–320` |
| SubagentStatusSurface | `tool-message.tsx:105–147` |
| SubagentStatusRow + openPreview | `tool-message.tsx:177–265` |
| defaultExpanded owner | `tool-message.tsx:76`, `tool-renderer.tsx:444` |
| ToolCallRenderer dispatch | `tool-renderer.tsx:84–100`, `225–372` |
| Timeline → ToolCallMessage | `messages-timeline.tsx:903–916`, `1014–1022` |
| workEntry.subagents | `tool-message.tsx:44`; type `session-logic.ts:50–69`, `173` |
| Tray migration sources | `subagent-preview-tray.tsx:145–402` |
| Task card CSS | `tool-call.css:41–81`, `113–116` |
| Subagent row shimmer CSS | `conversation.css:560–568` |
| Cursor l_d = 0 | `.cursor/research/cursor-subagent-click-flow.md:137` |
