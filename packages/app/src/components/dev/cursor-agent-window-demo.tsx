"use client";

import { Button } from "@multi/multikit/button";
import { Avatar, AvatarFallback } from "@multi/multikit/avatar";
import { SidebarButton } from "@multi/multikit/sidebar";
import { WorkbenchTextButton } from "@multi/multikit/workbench-button";
import type {
  EnvironmentId,
  GitFilePatchResult,
  MessageId,
  OrchestrationProposedPlanId,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
  TurnId,
} from "@multi/contracts";
import {
  IconBranch,
  IconChevronRightMedium,
  IconCircle,
  IconConsole,
  IconFileText,
  IconFiles,
  IconMicrophone,
  IconPlusMedium,
  IconSettingsSliderHor,
  IconSquareChecklist,
} from "central-icons";
import { useRef, useState, type ComponentType } from "react";

import { ChatMessageBubble } from "~/components/chat/message/message-surface";
import { AssistantTranscriptRow } from "~/components/chat/message/transcript-rows";
import { ChatHeader as ProductChatHeader } from "~/components/chat/view/chat-header";
import { AgentSidebar } from "~/components/shell/agents/sidebar";
import type { SidebarSectionModel } from "~/components/shell/agents/sidebar/types";
import { GitDiffCard } from "~/components/shell/git/git-diff-card";
import { PlanWorkbenchPanel } from "~/components/shell/plan/plan-workbench-panel";
import { ShellSidebarFooter } from "~/components/shell/sidebar/footer";
import { ShellSidebarHeader } from "~/components/shell/sidebar/header";
import { AppShell, type RightWorkbenchDefinition } from "~/components/shell/shell/app";
import { WorkbenchPanel } from "~/components/shell/shell/workbench-panel";
import { useMountEffect } from "~/hooks/use-mount-effect";
import type { DiffRow } from "~/hooks/use-environment-git";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import type { ChatMessage } from "~/types";

type DemoIcon = ComponentType<{ className?: string | undefined }>;

const DEMO_WORKSPACE_KEY = "dev:cursor-agent-window-demo";
const DEMO_CWD = "/Users/workgyver/Developer/multi";
const DEMO_ENVIRONMENT_ID = "demo-environment" as EnvironmentId;
const DEMO_PROJECT_ID = "demo-project-multi" as ProjectId;
const DEMO_PROJECT_REF: ScopedProjectRef = {
  environmentId: DEMO_ENVIRONMENT_ID,
  projectId: DEMO_PROJECT_ID,
};
const DEMO_TURN_ID = "demo-turn-cursor-agent-window" as TurnId;

const workbenchTabs = [
  {
    id: "plan",
    label: "Cursor Chat Parity",
    icon: IconSquareChecklist,
  },
  {
    id: "git",
    label: "Changes",
    icon: IconBranch,
    badge: "18",
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: IconConsole,
  },
  {
    id: "files",
    label: "Files",
    icon: IconFileText,
  },
] satisfies RightWorkbenchDefinition["tabs"];

const threads = [
  "Documentation update f...",
  "Cursor and subagent int...",
  "Workspace button and p...",
  "Workbench panel comp...",
  "Right side panel crash i...",
  "Empty initial page",
  "Workspace naming rem...",
  "Implementation plan for ...",
  "Test file migration plan",
  "Right sidebar default sta...",
  "Poteto-mode implement...",
] as const;

const planBullets = [
  "Boundary Discipline changed the backend sequence. UI hydration comes before server write-back, and durable write-back stays at the orchestration boundary.",
  "Type System Discipline changed the grouping plan. Runtime tools should get an explicit grouped row model instead of being forced into WorkLogEntry.",
  "Laziness Protocol changed scope. No new local bubble KV or persisted pending-row store in the first pass.",
  "Prove It Works changed verification. The plan requires a golden replay fixture instead of relying only on typecheck.",
  "Experience First changed the UI order. The first visible work targets flicker, grouped loading, and duplicate-row prevention for the end user.",
  "Minimize Reader Load changed ownership. Extracting timeline assembly from ChatView comes before adding more state to it.",
  "Redesign from First Principles changed the runtime plan. Pi session lifecycle becomes foundational instead of a later hydration patch.",
] as const;

const todos = [
  "Extract and test chat timeline assembly from ChatView.",
  "Define and implement runtime thinking/tool grouping with isolation rules.",
  "Add Cursor-style grouped tail freeze and final-group loading behavior.",
  "Update row identity and virtualizer estimates for grouped runtime rows.",
  "Add Pi-style runtime lifecycle and hydrate-on-open using explicit session managers.",
  "Bind Multi thread IDs to Pi SessionManager files.",
  "Persist assistant/tool/subagent completion into orchestration.",
  "Add golden replay fixture coverage for the grouped timeline.",
  "Prevent duplicate rows during draft-to-thread hydration.",
] as const;

const demoPlanMarkdown = `# Cursor Chat Parity

${planBullets.map((item) => `- ${item}`).join("\n")}`;

const demoActiveProposedPlan: LatestProposedPlanState = {
  id: "demo-cursor-chat-parity-plan" as OrchestrationProposedPlanId,
  createdAt: "2026-06-06T21:19:06.000Z",
  updatedAt: "2026-06-06T21:19:06.000Z",
  turnId: DEMO_TURN_ID,
  planMarkdown: demoPlanMarkdown,
  implementedAt: "2026-06-06T21:20:30.000Z",
  implementationThreadId: null,
};

const demoActivePlan: ActivePlanState = {
  createdAt: "2026-06-06T21:19:06.000Z",
  turnId: DEMO_TURN_ID,
  steps: todos.map((todo, index) => ({
    step: todo,
    status: index < 6 ? "completed" : "pending",
  })),
};

const demoAssistantMessage: ChatMessage = {
  id: "demo-assistant-message" as MessageId,
  role: "assistant",
  text: `Yes. I had added one forced delay:

\`\`\`text
Test Files  4 passed (4)
     Tests  43 passed (43)
  Start at  21:19:06
  Duration  1.24s (transform 1.09s, setup 0ms, import 3.75s,
tests 16ms, environment 2ms)
\`\`\`

\`step-renderer.tsx\` had a 200ms loading-header debounce. That could feel laggy. I removed it.

I also found a possible route-handoff contention point:

\`RuntimeThreadHydrationSync\` started runtime hydration immediately on server-thread mount. It was async, but it could still compete with the draft-to-thread page paint. I deferred it until after the next frame plus a macrotask, so navigation can paint first.

Verification passed:

- \`pnpm --filter @multi/app run typecheck\`
- Focused app tests. 4 files, 43 tests.

No page transition animation was added. Existing transition classes are mostly shell/sidebar/workbench or chevron/subagent UI.`,
  turnId: DEMO_TURN_ID,
  createdAt: "2026-06-06T21:20:30.000Z",
  streaming: false,
};

function threadId(index: number): ThreadId {
  return `demo-thread-${index}` as ThreadId;
}

function threadRef(id: ThreadId): ScopedThreadRef {
  return {
    environmentId: DEMO_ENVIRONMENT_ID,
    threadId: id,
  };
}

function sidebarThread(input: {
  readonly index: number;
  readonly title: string;
  readonly projectRef: ScopedProjectRef | null;
  readonly projectId: ProjectId | null;
  readonly ago: string;
}) {
  const id = threadId(input.index);
  return {
    id,
    kind: "thread",
    state: "idle",
    unread: false,
    pinned: false,
    latestReadableAt: "2026-06-06T21:36:38.000Z",
    threadRef: threadRef(id),
    title: input.title,
    updatedAt: "2026-06-06T21:36:38.000Z",
    ago: input.ago,
    cwd: DEMO_CWD,
    environmentId: DEMO_ENVIRONMENT_ID,
    projectId: input.projectId,
    workspaceProjectRef: input.projectRef,
    projectCwd: DEMO_CWD,
  } satisfies SidebarSectionModel["items"][number];
}

const demoSidebarSections: SidebarSectionModel[] = [
  {
    id: "skills",
    label: "skills",
    cwd: "/Users/workgyver/.agents/skills",
    active: false,
    canCreateAgent: false,
    canOpenInEditor: false,
    sectionThreadRefs: [threadRef(threadId(0))],
    threadRefs: [threadRef(threadId(0))],
    items: [
      sidebarThread({
        index: 0,
        title: threads[0],
        projectRef: null,
        projectId: null,
        ago: "Fri",
      }),
    ],
  },
  {
    id: "multi",
    label: "multi",
    cwd: DEMO_CWD,
    active: true,
    canCreateAgent: false,
    canOpenInEditor: false,
    projectId: DEMO_PROJECT_ID,
    projectRef: DEMO_PROJECT_REF,
    projectCwd: DEMO_CWD,
    sectionThreadRefs: threads.slice(1).map((_, index) => threadRef(threadId(index + 1))),
    threadRefs: threads.slice(1).map((_, index) => threadRef(threadId(index + 1))),
    items: threads.slice(1).map((title, index) =>
      sidebarThread({
        index: index + 1,
        title,
        projectRef: DEMO_PROJECT_REF,
        projectId: DEMO_PROJECT_ID,
        ago: index === 0 ? "now" : "Sat",
      }),
    ),
  },
];

const demoDiffRows: DiffRow[] = [
  {
    id: "step-renderer",
    path: "packages/app/src/components/chat/timeline/step-renderer.tsx",
    prevPath: null,
    state: "modified",
    staged: false,
    unstaged: true,
    add: 42,
    del: 8,
  },
  {
    id: "diff-viewer",
    path: "packages/app/src/components/shell/git/diff-viewer.tsx",
    prevPath: null,
    state: "modified",
    staged: false,
    unstaged: true,
    add: 118,
    del: 31,
  },
  {
    id: "shell-css",
    path: "packages/app/src/styles/shell.css",
    prevPath: null,
    state: "modified",
    staged: false,
    unstaged: true,
    add: 24,
    del: 6,
  },
  {
    id: "screenshot",
    path: "CleanShot 2026-06-06 at 21.36.38@2x.png",
    prevPath: null,
    state: "added",
    staged: false,
    unstaged: true,
    add: 0,
    del: 0,
  },
  {
    id: "notes",
    path: "implementation-notes.md",
    prevPath: null,
    state: "added",
    staged: false,
    unstaged: true,
    add: 9,
    del: 0,
  },
] satisfies DiffRow[];

const demoPatchById: ReadonlyMap<string, GitFilePatchResult> = new Map([
  [
    "step-renderer",
    {
      kind: "patch",
      patch: `diff --git a/packages/app/src/components/chat/timeline/step-renderer.tsx b/packages/app/src/components/chat/timeline/step-renderer.tsx
index 2f1d7a0..8ac31d2 100644
--- a/packages/app/src/components/chat/timeline/step-renderer.tsx
+++ b/packages/app/src/components/chat/timeline/step-renderer.tsx
@@ -42,8 +42,11 @@ export function StepRenderer(props: StepRendererProps) {
-  const showLoadingHeader = useDebouncedValue(isLoading, 200);
+  const showLoadingHeader = isLoading;
 
-  return <StepHeader loading={showLoadingHeader} />;
+  return (
+    <StepHeader
+      loading={showLoadingHeader}
+      grouped={props.grouped}
+    />
+  );
 }`,
    },
  ],
  [
    "diff-viewer",
    {
      kind: "patch",
      patch: `diff --git a/packages/app/src/components/shell/git/diff-viewer.tsx b/packages/app/src/components/shell/git/diff-viewer.tsx
index b9e51fd..e824be2 100644
--- a/packages/app/src/components/shell/git/diff-viewer.tsx
+++ b/packages/app/src/components/shell/git/diff-viewer.tsx
@@ -18,7 +18,10 @@ export function DiffViewer(props: Props) {
   const fileType = getGitFileTypeDescriptor({
     path: props.path,
     patch: props.filePatch,
   });
+
+  if (props.filePatch?.kind === "non_text") {
+    return <GitDiffPlaceholder descriptor={fileType} message={props.filePatch.message} />;
+  }
 
   return <PatchDiff patch={patch} options={options} />;
 }`,
    },
  ],
  [
    "shell-css",
    {
      kind: "patch",
      patch: `diff --git a/packages/app/src/styles/shell.css b/packages/app/src/styles/shell.css
index aac4521..afc7128 100644
--- a/packages/app/src/styles/shell.css
+++ b/packages/app/src/styles/shell.css
@@ -210,6 +210,10 @@
 .multi-shell-workbench-columns {
   min-width: 0;
 }
+
+.multi-shell-secondary-rail {
+  background: var(--multi-workbench-panel-background);
+}
 `,
    },
  ],
  [
    "screenshot",
    {
      kind: "non_text",
      fileType: "image",
      message: "Image file. Binary preview is represented by the file type placeholder.",
    },
  ],
  [
    "notes",
    {
      kind: "untracked",
      patch: `diff --git a/implementation-notes.md b/implementation-notes.md
new file mode 100644
index 0000000..a1340b2
--- /dev/null
+++ b/implementation-notes.md
@@ -0,0 +1,9 @@
+# Cursor Chat Parity
+
+- Boundary Discipline changed the backend sequence.
+- Type System Discipline changed the grouping plan.
+- Laziness Protocol changed scope.
+- Prove It Works changed verification.
+- Experience First changed the UI order.
+- Minimize Reader Load changed ownership.
+- Redesign from First Principles changed the runtime plan.
`,
    },
  ],
]);

function DemoSidebarAction(props: { readonly icon: DemoIcon; readonly label: string }) {
  const Icon = props.icon;
  return (
    <SidebarButton
      variant="chrome"
      className="w-full flex-1 text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
    >
      <Icon className="size-4 shrink-0 opacity-65" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </SidebarButton>
  );
}

function DemoAccountFooter() {
  return (
    <div className="shrink-0 px-3 pt-1">
      <div className="flex min-h-9 min-w-0 items-center gap-2 rounded-multi-control px-1.5 py-1">
        <Avatar className="size-7 shrink-0">
          <AvatarFallback>DF</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-detail text-multi-fg-primary">Daniel Fu</div>
          <div className="truncate text-caption text-multi-fg-tertiary">Ultra Plan</div>
        </div>
      </div>
    </div>
  );
}

function DemoLeftRail() {
  return (
    <div className="thread-rail-pad relative flex min-h-0 flex-1 flex-col px-0">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-(--multi-shell-sidebar-content-top-offset,var(--multi-electron-traffic-padding-top))"
        aria-hidden="true"
      />
      <ShellSidebarHeader onNewChat={() => undefined} />
      <div className="relative z-30 flex shrink-0 select-none flex-col gap-1 px-2 pb-1.5">
        <DemoSidebarAction icon={IconSquareChecklist} label="Automations" />
        <DemoSidebarAction icon={IconSettingsSliderHor} label="Customize" />
      </div>
      <AgentSidebar
        loading={false}
        error={false}
        sections={demoSidebarSections}
        selectedId={threadId(1)}
        onSelectAgent={() => undefined}
        onPrefetchAgent={() => undefined}
        onOpenWorkspace={() => undefined}
      />
      <DemoAccountFooter />
      <ShellSidebarFooter />
    </div>
  );
}

function DemoChatCenter() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-multi-bg-primary">
      <header className="agent-window-chat-header pointer-events-none box-border flex h-(--multi-workbench-chrome-row-height) select-none items-center px-(--multi-workbench-chrome-padding-inline)">
        <ProductChatHeader activeThreadTitle="Cursor and subagent integration analysis" />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-6 pt-4">
        <div className="max-w-[690px]">
          <ChatMessageBubble
            messageRole="user"
            body="did we force a duration/animation, animate any of the components, it feels like it lags instead of a smooth transition of pages from draft to thread page"
          />
        </div>

        <div className="mt-4 max-w-[720px]">
          <AssistantTranscriptRow message={demoAssistantMessage} markdownCwd={DEMO_CWD} />
        </div>
      </div>

      <footer className="shrink-0 border-t border-multi-stroke-tertiary bg-multi-bg-primary px-5 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Button type="button" variant="outline" className="h-8 rounded-full">
            Changes <span className="text-multi-diff-addition">+17895</span>{" "}
            <span className="text-multi-diff-deletion">-3099</span>
          </Button>
          <Button type="button" variant="outline" className="h-8 rounded-full">
            Commit &amp; Push
            <IconChevronRightMedium className="size-3 rotate-90" />
          </Button>
        </div>
        <div className="flex h-11 items-center gap-2 rounded-full border border-multi-stroke-tertiary bg-multi-bg-secondary px-2">
          <Button
            type="button"
            size="icon-lg"
            variant="ghost"
            className="rounded-full"
            aria-label="Add context"
          >
            <IconPlusMedium className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 text-body text-multi-fg-tertiary">Send follow-up</span>
          <WorkbenchTextButton tone="default">
            GPT-5.5 High
            <IconChevronRightMedium className="size-3 rotate-90" />
          </WorkbenchTextButton>
          <Button
            type="button"
            size="icon-lg"
            variant="secondary"
            className="rounded-full"
            aria-label="Voice input"
          >
            <IconMicrophone className="size-4" />
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-detail text-multi-fg-tertiary">
          <div className="flex items-center gap-4">
            <span>bigrefactor</span>
            <span>Local</span>
          </div>
          <div className="flex items-center gap-1">
            <IconCircle className="size-3" />
            <span>100%</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function DemoPlanPanel() {
  return (
    <WorkbenchPanel>
      <PlanWorkbenchPanel
        activePlan={demoActivePlan}
        activeProposedPlan={demoActiveProposedPlan}
        environmentId={null}
        label="Plan"
        markdownCwd={DEMO_CWD}
        timestampFormat="locale"
      />
    </WorkbenchPanel>
  );
}

function DemoGitPanel() {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(demoDiffRows.map((row) => row.id)),
  );
  const [viewedIds, setViewedIds] = useState<ReadonlySet<string>>(() => new Set());
  const requestPrefetchForIdRef = useRef<(id: string) => void>(() => undefined);
  const setExpanded = (id: string, open: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (open) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };
  const toggleViewed = (id: string) => {
    setViewedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <WorkbenchPanel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-multi-stroke-tertiary px-3">
        <IconBranch className="size-4 text-multi-icon-secondary" />
        <span className="min-w-0 flex-1 truncate text-body text-multi-fg-primary">Changes</span>
        <span className="font-mono text-caption text-multi-diff-addition">+17895</span>
        <span className="font-mono text-caption text-multi-diff-deletion">-3099</span>
      </div>
      <div className="git-diff-scroll-root min-h-0 flex-1 overflow-y-auto">
        {demoDiffRows.map((file) => (
          <GitDiffCard
            key={file.id}
            file={file}
            selected={false}
            expanded={expandedIds.has(file.id)}
            onExpandedChange={(open) => setExpanded(file.id, open)}
            patch={demoPatchById.get(file.id) ?? null}
            diffRequested
            loaded
            loading={false}
            error={null}
            diffStyle="unified"
            viewed={viewedIds.has(file.id)}
            onToggleViewed={() => toggleViewed(file.id)}
            onRevert={() => undefined}
            requestPrefetchForIdRef={requestPrefetchForIdRef}
          />
        ))}
      </div>
    </WorkbenchPanel>
  );
}

function DemoTerminalPanel() {
  return (
    <WorkbenchPanel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-multi-stroke-tertiary px-3">
        <IconConsole className="size-4 text-multi-icon-secondary" />
        <span className="min-w-0 flex-1 truncate text-body text-multi-fg-primary">Terminal</span>
        <span className="text-caption text-multi-fg-tertiary">bigrefactor</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-hidden p-4 font-mono text-detail/[1.25rem] text-multi-fg-secondary">
        {`pnpm --filter @multi/app run typecheck

Test Files  4 passed (4)
     Tests  43 passed (43)
  Start at  21:19:06
  Duration  1.24s

Focused app tests passed.`}
      </pre>
    </WorkbenchPanel>
  );
}

function DemoFilesPanel() {
  return (
    <WorkbenchPanel>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-multi-stroke-tertiary px-3">
        <IconFiles className="size-4 text-multi-icon-secondary" />
        <span className="min-w-0 flex-1 truncate text-body text-multi-fg-primary">multi</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {demoDiffRows.map((file) => (
          <div
            key={file.id}
            className="flex min-h-8 min-w-0 items-center gap-2 border-b border-multi-workbench-panel-border-muted px-3 text-detail"
          >
            <IconFileText className="size-4 shrink-0 text-multi-icon-secondary" />
            <span className="min-w-0 flex-1 truncate text-multi-fg-secondary">{file.path}</span>
            {file.add > 0 ? (
              <span className="shrink-0 text-multi-diff-addition">+{file.add}</span>
            ) : null}
            {file.del > 0 ? (
              <span className="shrink-0 text-multi-diff-deletion">-{file.del}</span>
            ) : null}
          </div>
        ))}
      </div>
    </WorkbenchPanel>
  );
}

function createRightWorkbench(): RightWorkbenchDefinition {
  return {
    tabs: workbenchTabs,
    panels: {
      plan: <DemoPlanPanel />,
      git: <DemoGitPanel />,
      terminal: <DemoTerminalPanel />,
      files: <DemoFilesPanel />,
    },
  };
}

export function CursorAgentWindowDemoPage() {
  useMountEffect(() => {
    shellPanelsActions.setLeftOpen(true);
    shellPanelsActions.setLeftWidth(300);
    shellPanelsActions.setRightOpen(true, DEMO_WORKSPACE_KEY);
    shellPanelsActions.setRightWidth(600);
    shellPanelsActions.setActiveTab("plan", DEMO_WORKSPACE_KEY);
    shellPanelsActions.setMuted(false, DEMO_WORKSPACE_KEY);
    syncAppearanceVibrancy();
  });

  return (
    <div className="h-screen min-h-0 w-screen min-w-[1180px] overflow-hidden bg-multi-bg-primary font-multi text-multi-fg-primary">
      <AppShell
        cwd={DEMO_CWD}
        workspaceKey={DEMO_WORKSPACE_KEY}
        left={<DemoLeftRail />}
        center={<DemoChatCenter />}
        centerSurface="chat"
        right={createRightWorkbench()}
        routeThreadId="cursor-agent-window-demo"
      />
    </div>
  );
}
