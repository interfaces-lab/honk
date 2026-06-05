import {
  IconArchive1,
  IconChevronDownMedium,
  IconChevronLeftMedium,
  IconCollaborationPointerRight,
  IconFolder1,
  IconMagnifyingGlass,
} from "central-icons";
import type { ReactNode } from "react";

import { Text } from "@multi/multikit/text";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { cn } from "~/lib/utils";

const MOCK_ARCHIVED_PROJECT = { name: "multi", path: "workgyver/Developer/multi" } as const;

const MOCK_ARCHIVED_THREADS = [
  { id: "t1", title: "Implement compact sidebar rows", archivedAgo: "2d ago" },
  { id: "t2", title: "Archive confirmation polish", archivedAgo: "1w ago" },
  { id: "t3", title: "Composer send queue edge cases", archivedAgo: "3w ago" },
] as const;

const tabClass = (on: boolean) =>
  cn(
    "flex flex-1 items-center justify-center gap-1 rounded-multi-control py-1 text-(length:--multi-text-detail)",
    on ? "bg-multi-bg-quaternary text-multi-fg-primary" : "text-multi-fg-tertiary",
  );

/** 20 placement demos — picker label must match `data-uidotsh-option`. */
const ARCHIVE_PLACEMENT_DEMOS = [
  {
    id: "settings-current",
    label: "01 Settings Archived (current)",
    description: "Full settings route with nav rail — production today.",
  },
  {
    id: "sidebar-tab",
    label: "02 Sidebar Agents | Archive tab",
    description: "Dedicated tab on the left thread rail.",
  },
  {
    id: "hybrid",
    label: "03 Hybrid rail + settings",
    description: "Quick restore in rail; deep management stays in settings.",
  },
  {
    id: "sidebar-accordion",
    label: "04 Sidebar accordion section",
    description: "Collapsed “Archived (3)” section at the bottom of the agent list.",
  },
  {
    id: "project-chevron",
    label: "05 Per-project chevron expand",
    description: "Each project header shows archive count; chevron expands inline list.",
  },
  {
    id: "project-row-switch",
    label: "06 Per-project header switch",
    description: "Toggle on each project row reveals archived threads under that project only.",
  },
  {
    id: "row-sibling-switch",
    label: "07 Per-row sibling switch",
    description: "Toggle on an active agent row reveals archived siblings in the same project.",
  },
  {
    id: "sidebar-footer-drawer",
    label: "08 Sidebar footer drawer",
    description: "“View archived” in sidebar footer; list slides up over the rail.",
  },
  {
    id: "workbench-tab",
    label: "09 Right workbench tab",
    description: "Archive as a fourth workbench tab beside Git, terminal, files.",
  },
  {
    id: "secondary-rail",
    label: "10 Secondary icon rail",
    description: "Ultra-narrow strip with archive stack; click opens list flyout.",
  },
  {
    id: "header-badge-popover",
    label: "11 Header badge popover",
    description: "Archive count pill on sidebar header opens a anchored popover list.",
  },
  {
    id: "slide-over",
    label: "12 Left slide-over panel",
    description: "Full-height overlay from the rail; chat dims behind.",
  },
  {
    id: "modal-vault",
    label: "13 Center modal vault",
    description: "Focused modal with search — good for bulk review.",
  },
  {
    id: "command-palette",
    label: "14 Command palette only",
    description: "No persistent surface; archive threads are palette results + actions.",
  },
  {
    id: "composer-strip",
    label: "15 Composer strip",
    description: "Thin collapsible strip above follow-up input while in a thread.",
  },
  {
    id: "title-breadcrumb-menu",
    label: "16 Chat title menu",
    description: "Archived threads listed under the conversation title dropdown.",
  },
  {
    id: "split-pane",
    label: "17 Split sidebar pane",
    description: "Draggable split: agents on top, archive on bottom (resizable).",
  },
  {
    id: "section-context-menu",
    label: "18 Section context menu",
    description: "“Show archived (2)” on project section right-click — opens subview.",
  },
  {
    id: "timeline-spine",
    label: "19 Timeline spine",
    description: "Vertical archive timeline along the chat edge; dot opens detail.",
  },
  {
    id: "fab-archive-sheet",
    label: "20 Floating archive sheet",
    description: "FAB near composer corner opens bottom sheet with restore-primary rows.",
  },
] as const;

type ArchivePlacementDemoId = (typeof ARCHIVE_PLACEMENT_DEMOS)[number]["id"];

const demoFrameClass =
  "overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary";

function DemoCaption(props: { children: ReactNode }) {
  return (
    <Text render={<p />} size="sm" tone="tertiary">
      {props.children}
    </Text>
  );
}

function MockToggle(props: { on?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="presentation" aria-hidden="true">
      {props.label ? (
        <span className="text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
          {props.label}
        </span>
      ) : null}
      <span
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          props.on ? "bg-multi-fg-secondary" : "bg-multi-bg-quaternary",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-background shadow-sm transition-[left]",
            props.on ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
    </span>
  );
}

function MockArchivedRows(props: { compact?: boolean; indent?: boolean }) {
  return (
    <ul
      className={cn("space-y-px", props.indent && "border-l border-multi-stroke-quaternary pl-2")}
    >
      {MOCK_ARCHIVED_THREADS.map((thread) => (
        <li
          key={thread.id}
          className={cn(
            "flex items-center gap-2 rounded-multi-control hover:bg-multi-bg-quaternary",
            props.compact ? "px-1.5 py-1" : "px-2 py-1.5",
          )}
        >
          <IconArchive1 className="size-3 shrink-0 text-multi-icon-tertiary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-(length:--multi-sidebar-label-size) leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </p>
            <p className="text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              {thread.archivedAgo}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-quaternary px-1.5 py-0.5 text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-primary"
          >
            Restore
          </button>
        </li>
      ))}
    </ul>
  );
}

function MockAgentRow(props: { title: string; active?: boolean; trailing?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-multi-control px-2 py-1",
        props.active ? "bg-multi-bg-quaternary" : "hover:bg-multi-bg-quaternary/60",
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-multi-fg-quaternary" />
      <span className="min-w-0 flex-1 truncate text-(length:--multi-sidebar-label-size) leading-(--multi-sidebar-label-leading) text-multi-fg-secondary">
        {props.title}
      </span>
      {props.trailing}
    </div>
  );
}

function MockSidebarChrome(props: {
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  activeTab?: "agents" | "archive";
}) {
  return (
    <div className={cn(demoFrameClass, "flex w-full max-w-[232px] flex-col")} aria-hidden="true">
      <div className="space-y-1.5 border-b border-multi-stroke-quaternary px-2 py-2">
        <div className="flex h-6 items-center gap-1 rounded-multi-control bg-multi-bg-quaternary/70 px-2 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          <IconCollaborationPointerRight className="size-3.5 opacity-50" aria-hidden="true" />
          <span className="truncate">New Agent</span>
        </div>
        {props.headerExtra}
      </div>
      {props.activeTab ? (
        <div className="flex gap-1 px-2 pt-1.5">
          <div className={tabClass(props.activeTab === "agents")}>Agents</div>
          <div className={tabClass(props.activeTab === "archive")}>Archive</div>
        </div>
      ) : null}
      <div className="min-h-[200px] flex-1 overflow-hidden p-1">{props.children}</div>
      {props.footer ? (
        <div className="border-t border-multi-stroke-quaternary p-2">{props.footer}</div>
      ) : null}
    </div>
  );
}

function MockChatChrome(props: { children: ReactNode; rightSlot?: ReactNode }) {
  return (
    <div
      className={cn(demoFrameClass, "flex min-h-[220px] flex-1 flex-col bg-multi-bg-elevated")}
      aria-hidden="true"
    >
      <div className="flex h-8 items-center border-b border-multi-stroke-quaternary px-3 text-(length:--multi-text-detail) text-multi-fg-tertiary">
        Chat · multi
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 p-3 opacity-40">{props.children}</div>
        {props.rightSlot}
      </div>
    </div>
  );
}

function Demo01SettingsCurrent() {
  return (
    <div className="flex overflow-hidden rounded-lg border border-multi-stroke-quaternary">
      <nav className="flex w-[130px] shrink-0 flex-col gap-px border-r border-multi-stroke-quaternary bg-multi-bg-quinary p-2">
        <div className="flex items-center gap-1 px-1 py-1 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          <IconChevronLeftMedium className="size-3.5" aria-hidden="true" />
          Back
        </div>
        <div className="flex items-center gap-1.5 rounded-multi-control bg-multi-bg-tertiary px-1.5 py-1 text-(length:--multi-sidebar-label-size)">
          <IconArchive1 className="size-4 opacity-60" aria-hidden="true" />
          Archived
        </div>
      </nav>
      <div className="min-w-0 flex-1 space-y-2 bg-multi-bg-elevated p-3">
        <div className="flex items-center gap-1.5 text-multi-fg-tertiary">
          <IconFolder1 className="size-3.5" aria-hidden="true" />
          <span className="text-(length:--multi-sidebar-label-size)">
            {MOCK_ARCHIVED_PROJECT.name}
          </span>
        </div>
        <MockArchivedRows />
      </div>
    </div>
  );
}

function Demo02SidebarTab() {
  return (
    <div className="flex gap-3">
      <MockSidebarChrome activeTab="archive">
        <div className="space-y-2 px-1">
          <label className="relative block">
            <IconMagnifyingGlass
              className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-multi-icon-tertiary"
              aria-hidden="true"
            />
            <input
              readOnly
              placeholder="Search archived..."
              className="h-6 w-full rounded-multi-control border border-multi-stroke-quaternary bg-multi-bg-quinary pl-6 text-(length:--multi-text-detail)"
            />
          </label>
          <MockArchivedRows compact />
        </div>
      </MockSidebarChrome>
      <MockChatChrome>
        <div className="h-full rounded-md bg-multi-bg-quinary/50" />
      </MockChatChrome>
    </div>
  );
}

function Demo03Hybrid() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <MockSidebarChrome activeTab="archive">
          <MockArchivedRows compact />
        </MockSidebarChrome>
        <DemoCaption>Fast restore in rail while chatting.</DemoCaption>
      </div>
      <div className={cn(demoFrameClass, "bg-multi-bg-elevated p-3")}>
        <p className="mb-2 text-(length:--multi-text-detail) font-medium text-multi-fg-secondary">
          Settings → Archived
        </p>
        <MockArchivedRows />
      </div>
    </div>
  );
}

function Demo04SidebarAccordion() {
  return (
    <MockSidebarChrome>
      <div className="space-y-0.5 px-1">
        <MockAgentRow title="Fix composer layout" active />
        <MockAgentRow title="Sidebar polish" />
        <div className="mt-2 rounded-multi-control border border-multi-stroke-quaternary bg-multi-bg-quaternary/50">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-(length:--multi-sidebar-label-size) text-multi-fg-secondary"
          >
            <IconChevronDownMedium className="size-3.5" aria-hidden="true" />
            <IconArchive1 className="size-3.5 text-multi-icon-tertiary" aria-hidden="true" />
            <span className="flex-1 truncate text-left">Archived (3)</span>
          </button>
          <div className="border-t border-multi-stroke-quaternary px-1 pb-1">
            <MockArchivedRows compact />
          </div>
        </div>
      </div>
    </MockSidebarChrome>
  );
}

function Demo05ProjectChevron() {
  return (
    <MockSidebarChrome>
      <div className="space-y-1 px-1">
        <div className="rounded-multi-control bg-multi-bg-quaternary/40 px-2 py-1">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-(length:--multi-sidebar-label-size) text-multi-fg-tertiary"
          >
            <IconFolder1 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">{MOCK_ARCHIVED_PROJECT.name}</span>
            <span className="text-(length:--multi-text-detail) text-multi-fg-quaternary">
              2 archived
            </span>
            <IconChevronDownMedium className="size-3.5" aria-hidden="true" />
          </button>
          <div className="mt-1 pl-4">
            <MockArchivedRows compact indent />
          </div>
        </div>
        <MockAgentRow title="Active agent thread" active />
      </div>
    </MockSidebarChrome>
  );
}

function Demo06ProjectRowSwitch() {
  return (
    <MockSidebarChrome>
      <div className="space-y-1 px-1">
        <div className="flex items-center gap-1 rounded-multi-control px-2 py-1 hover:bg-multi-bg-quaternary">
          <IconFolder1 className="size-3.5 text-multi-icon-tertiary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-(length:--multi-sidebar-label-size) text-multi-fg-tertiary">
            {MOCK_ARCHIVED_PROJECT.name}
          </span>
          <MockToggle on label="Archived" />
        </div>
        <MockArchivedRows compact indent />
        <MockAgentRow title="Current thread" active />
      </div>
    </MockSidebarChrome>
  );
}

function Demo07RowSiblingSwitch() {
  return (
    <MockSidebarChrome>
      <div className="space-y-0.5 px-1">
        <MockAgentRow title="Implement sidebar rows" active trailing={<MockToggle on />} />
        <MockArchivedRows compact indent />
        <MockAgentRow title="Other active agent" />
      </div>
    </MockSidebarChrome>
  );
}

function Demo08SidebarFooterDrawer() {
  return (
    <div className="relative">
      <MockSidebarChrome
        footer={
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-multi-control border border-multi-stroke-quaternary py-1.5 text-(length:--multi-text-detail) text-multi-fg-secondary"
          >
            <IconArchive1 className="size-3.5" aria-hidden="true" />
            View 3 archived
          </button>
        }
      >
        <MockAgentRow title="Active agent" active />
        <MockAgentRow title="Another thread" />
      </MockSidebarChrome>
      <div className="pointer-events-none absolute inset-x-4 bottom-14 overflow-hidden rounded-t-lg border border-b-0 border-multi-stroke-quaternary bg-multi-bg-elevated shadow-lg">
        <div className="border-b border-multi-stroke-quaternary px-2 py-1.5 text-(length:--multi-text-detail) font-medium text-multi-fg-secondary">
          Archived
        </div>
        <div className="max-h-[120px] overflow-hidden p-1">
          <MockArchivedRows compact />
        </div>
      </div>
    </div>
  );
}

function Demo09WorkbenchTab() {
  return (
    <div className="flex gap-2">
      <MockChatChrome>
        <div className="h-full rounded-md bg-multi-bg-quinary/40" />
      </MockChatChrome>
      <div className={cn(demoFrameClass, "flex w-full max-w-[200px] flex-col")}>
        <div className="flex gap-1 border-b border-multi-stroke-quaternary p-2">
          {["Git", "Term", "Files", "Archive"].map((tab) => (
            <span
              key={tab}
              className={cn(
                "rounded-multi-control px-1.5 py-0.5 text-(length:--multi-text-detail)",
                tab === "Archive"
                  ? "bg-multi-bg-quaternary text-multi-fg-primary"
                  : "text-multi-fg-tertiary",
              )}
            >
              {tab}
            </span>
          ))}
        </div>
        <div className="flex-1 p-2">
          <MockArchivedRows compact />
        </div>
      </div>
    </div>
  );
}

function Demo10SecondaryRail() {
  return (
    <div className="flex gap-0">
      <MockSidebarChrome>
        <MockAgentRow title="Active agent" active />
      </MockSidebarChrome>
      <div className="flex w-10 flex-col items-center gap-2 border-y border-r border-multi-stroke-quaternary bg-multi-bg-quinary py-3">
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-multi-control bg-multi-bg-quaternary text-multi-fg-primary"
          aria-label="Archive"
        >
          <IconArchive1 className="size-4" aria-hidden="true" />
        </button>
        <span className="text-(length:--multi-text-detail) tabular-nums text-multi-fg-tertiary">
          3
        </span>
      </div>
      <div className={cn(demoFrameClass, "w-[160px] border-l-0 p-2")}>
        <MockArchivedRows compact />
      </div>
    </div>
  );
}

function Demo11HeaderBadgePopover() {
  return (
    <div className="relative inline-block">
      <MockSidebarChrome
        headerExtra={
          <button
            type="button"
            className="ml-auto flex h-5 items-center gap-1 rounded-full border border-multi-stroke-secondary bg-multi-bg-quaternary px-2 text-(length:--multi-text-detail) font-medium text-multi-fg-primary"
          >
            <IconArchive1 className="size-3" aria-hidden="true" />3
          </button>
        }
      >
        <MockAgentRow title="Active thread" active />
      </MockSidebarChrome>
      <div className="absolute top-12 right-2 z-10 w-[200px] overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-elevated shadow-md">
        <p className="border-b border-multi-stroke-quaternary px-2 py-1.5 text-(length:--multi-text-detail) font-medium text-multi-fg-secondary">
          Archived
        </p>
        <div className="p-1">
          <MockArchivedRows compact />
        </div>
      </div>
    </div>
  );
}

function Demo12SlideOver() {
  return (
    <div className="relative flex gap-2 overflow-hidden rounded-lg border border-multi-stroke-quaternary">
      <div className="w-[100px] shrink-0 bg-multi-bg-quinary/80 p-2 opacity-50">
        <div className="h-4 rounded bg-multi-bg-quaternary" />
      </div>
      <div className="absolute inset-y-0 left-[72px] z-10 flex w-[200px] flex-col border-r border-multi-stroke-quaternary bg-multi-bg-elevated shadow-xl">
        <div className="flex items-center justify-between border-b border-multi-stroke-quaternary px-3 py-2">
          <span className="text-(length:--multi-sidebar-label-size) font-medium text-multi-fg-primary">
            Archive
          </span>
          <span className="text-(length:--multi-text-detail) text-multi-fg-tertiary">Esc</span>
        </div>
        <div className="flex-1 overflow-hidden p-2">
          <MockArchivedRows compact />
        </div>
      </div>
      <MockChatChrome>
        <div className="h-full rounded-md bg-multi-bg-quinary/30" />
      </MockChatChrome>
    </div>
  );
}

function Demo13ModalVault() {
  return (
    <div className="relative flex min-h-[240px] items-center justify-center rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary/50 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-multi-stroke-quaternary bg-multi-bg-elevated shadow-lg">
        <div className="flex items-center justify-between border-b border-multi-stroke-quaternary px-4 py-3">
          <span className="text-(length:--multi-sidebar-label-size) font-medium text-multi-fg-primary">
            Archive vault
          </span>
          <span className="text-(length:--multi-text-detail) text-multi-fg-tertiary">Close</span>
        </div>
        <div className="space-y-3 p-4">
          <input
            readOnly
            placeholder="Search all archived threads..."
            aria-label="Search all archived threads"
            className="h-8 w-full rounded-multi-control border border-multi-stroke-quaternary px-3 text-(length:--multi-text-detail)"
          />
          <MockArchivedRows />
        </div>
      </div>
    </div>
  );
}

function Demo14CommandPalette() {
  return (
    <div className={cn(demoFrameClass, "mx-auto max-w-md bg-multi-bg-elevated p-2")}>
      <div className="rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary px-3 py-2 text-(length:--multi-text-detail) text-multi-fg-tertiary">
        Search threads, commands...
      </div>
      <div className="mt-2 space-y-px px-1">
        <p className="px-2 py-1 text-(length:--multi-text-detail) font-medium text-multi-fg-tertiary">
          Archived
        </p>
        {MOCK_ARCHIVED_THREADS.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-multi-control px-2 py-1.5 hover:bg-multi-bg-quaternary"
          >
            <IconArchive1 className="size-3.5 text-multi-icon-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-(length:--multi-sidebar-label-size) text-multi-fg-primary">
              {t.title}
            </span>
            <span className="text-(length:--multi-text-detail) text-multi-fg-tertiary">
              Restore
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Demo15ComposerStrip() {
  return (
    <MockChatChrome>
      <div className="mt-auto space-y-2">
        <div className="overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-(length:--multi-text-detail) text-multi-fg-secondary"
          >
            <IconArchive1 className="size-3.5" aria-hidden="true" />
            <span>Archived in this project (2)</span>
            <IconChevronDownMedium className="ml-auto size-3.5" aria-hidden="true" />
          </button>
          <div className="border-t border-multi-stroke-quaternary px-2 pb-2">
            <MockArchivedRows compact />
          </div>
        </div>
        <div className="h-10 rounded-full border border-multi-stroke-quaternary bg-multi-bg-quinary/80" />
      </div>
    </MockChatChrome>
  );
}

function Demo16TitleBreadcrumbMenu() {
  return (
    <div className={cn(demoFrameClass, "bg-multi-bg-elevated")}>
      <div className="relative border-b border-multi-stroke-quaternary px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1 text-(length:--multi-sidebar-label-size) font-medium text-multi-fg-primary"
        >
          Implement compact sidebar
          <IconChevronDownMedium className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
        <div className="absolute top-full left-3 z-10 mt-1 w-[220px] overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary shadow-md">
          <p className="border-b border-multi-stroke-quaternary px-2 py-1 text-(length:--multi-text-detail) text-multi-fg-tertiary">
            Archived in project
          </p>
          <div className="p-1">
            <MockArchivedRows compact />
          </div>
        </div>
      </div>
      <div className="h-32 p-3 opacity-30">Message area</div>
    </div>
  );
}

function Demo17SplitPane() {
  return (
    <MockSidebarChrome>
      <div className="flex h-[220px] flex-col px-1">
        <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
          <MockAgentRow title="Active agent" active />
          <MockAgentRow title="Plan mode thread" />
        </div>
        <div className="my-1 h-px shrink-0 bg-multi-stroke-quaternary" aria-hidden="true" />
        <div className="flex shrink-0 items-center gap-1 px-1 py-0.5 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          <IconArchive1 className="size-3" aria-hidden="true" />
          Archived
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <MockArchivedRows compact />
        </div>
      </div>
    </MockSidebarChrome>
  );
}

function Demo18SectionContextMenu() {
  return (
    <div className="relative">
      <MockSidebarChrome>
        <div className="px-2 py-1 text-(length:--multi-sidebar-label-size) text-multi-fg-tertiary">
          {MOCK_ARCHIVED_PROJECT.name}
        </div>
        <MockAgentRow title="Active thread" active />
      </MockSidebarChrome>
      <div className="absolute top-10 left-[120px] z-10 min-w-[160px] overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-elevated py-1 shadow-lg">
        <div className="px-2.5 py-1 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          Pin section
        </div>
        <div className="flex items-center gap-2 bg-multi-bg-quaternary px-2.5 py-1 text-(length:--multi-text-detail) text-multi-fg-primary">
          <IconArchive1 className="size-3" aria-hidden="true" />
          Show archived (2)
        </div>
        <div className="px-2.5 py-1 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          Archive all
        </div>
      </div>
    </div>
  );
}

function Demo19TimelineSpine() {
  return (
    <div className="flex gap-0 overflow-hidden rounded-lg border border-multi-stroke-quaternary">
      <MockChatChrome>
        <div className="h-full rounded-md bg-multi-bg-quinary/40" />
      </MockChatChrome>
      <div className="flex w-12 shrink-0 flex-col items-center gap-3 border-l border-multi-stroke-quaternary bg-multi-bg-quinary py-4">
        {MOCK_ARCHIVED_THREADS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className="relative flex flex-col items-center gap-1"
            title={t.title}
          >
            <span
              className={cn(
                "size-2.5 rounded-full border-2",
                i === 0
                  ? "border-multi-fg-secondary bg-multi-fg-secondary"
                  : "border-multi-stroke-secondary bg-transparent",
              )}
            />
            {i < MOCK_ARCHIVED_THREADS.length - 1 ? (
              <span className="absolute top-3 h-6 w-px bg-multi-stroke-quaternary" />
            ) : null}
          </button>
        ))}
      </div>
      <div className={cn(demoFrameClass, "w-[180px] border-l-0 p-2")}>
        <p className="mb-1 truncate text-(length:--multi-sidebar-label-size) font-medium text-multi-fg-primary">
          {MOCK_ARCHIVED_THREADS[0].title}
        </p>
        <p className="mb-2 text-(length:--multi-text-detail) text-multi-fg-tertiary">
          {MOCK_ARCHIVED_THREADS[0].archivedAgo}
        </p>
        <button
          type="button"
          className="rounded-multi-control border border-multi-stroke-secondary px-2 py-1 text-(length:--multi-text-detail) font-medium"
        >
          Restore
        </button>
      </div>
    </div>
  );
}

function Demo20FabArchiveSheet() {
  return (
    <div className="relative min-h-[240px] overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-elevated">
      <div className="p-4 opacity-30">Chat content</div>
      <button
        type="button"
        className="absolute right-4 bottom-16 flex size-10 items-center justify-center rounded-full border border-multi-stroke-secondary bg-multi-bg-quaternary shadow-md"
        aria-label="Archive"
      >
        <IconArchive1 className="size-4" aria-hidden="true" />
      </button>
      <div className="absolute inset-x-3 bottom-3 overflow-hidden rounded-xl border border-multi-stroke-quaternary bg-multi-bg-quinary shadow-lg">
        <div className="mx-auto mt-1.5 h-1 w-8 rounded-full bg-multi-stroke-quaternary" />
        <div className="border-b border-multi-stroke-quaternary px-3 py-2 text-(length:--multi-sidebar-label-size) font-medium text-multi-fg-primary">
          Archived
        </div>
        <div className="max-h-[140px] overflow-hidden p-2">
          <MockArchivedRows compact />
        </div>
      </div>
    </div>
  );
}

function ArchivePlacementDemoPreview(props: { demoId: ArchivePlacementDemoId }) {
  switch (props.demoId) {
    case "settings-current":
      return <Demo01SettingsCurrent />;
    case "sidebar-tab":
      return <Demo02SidebarTab />;
    case "hybrid":
      return <Demo03Hybrid />;
    case "sidebar-accordion":
      return <Demo04SidebarAccordion />;
    case "project-chevron":
      return <Demo05ProjectChevron />;
    case "project-row-switch":
      return <Demo06ProjectRowSwitch />;
    case "row-sibling-switch":
      return <Demo07RowSiblingSwitch />;
    case "sidebar-footer-drawer":
      return <Demo08SidebarFooterDrawer />;
    case "workbench-tab":
      return <Demo09WorkbenchTab />;
    case "secondary-rail":
      return <Demo10SecondaryRail />;
    case "header-badge-popover":
      return <Demo11HeaderBadgePopover />;
    case "slide-over":
      return <Demo12SlideOver />;
    case "modal-vault":
      return <Demo13ModalVault />;
    case "command-palette":
      return <Demo14CommandPalette />;
    case "composer-strip":
      return <Demo15ComposerStrip />;
    case "title-breadcrumb-menu":
      return <Demo16TitleBreadcrumbMenu />;
    case "split-pane":
      return <Demo17SplitPane />;
    case "section-context-menu":
      return <Demo18SectionContextMenu />;
    case "timeline-spine":
      return <Demo19TimelineSpine />;
    case "fab-archive-sheet":
      return <Demo20FabArchiveSheet />;
  }
}

function ArchivePlacementDemoGallery() {
  return (
    <div data-uidotsh-pick="Archive placement (20 demos)" className="contents">
      {ARCHIVE_PLACEMENT_DEMOS.map((demo, index) => (
        <div
          key={demo.id}
          data-uidotsh-option={demo.label}
          className="contents"
          {...(index === 0 ? {} : { hidden: true })}
        >
          <div className="space-y-3">
            <DemoCaption>{demo.description}</DemoCaption>
            <ArchivePlacementDemoPreview demoId={demo.id} />
          </div>
        </div>
      ))}
    </div>
  );
}

function useUiPickerScript() {
  useMountEffect(() => {
    if (document.querySelector("script[data-uidotsh-picker]")) {
      return;
    }
    const script = document.createElement("script");
    script.src = "https://ui.sh/ui-picker.js";
    script.dataset.uidotshPicker = "";
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  });
}

function ArchiveUiExampleNotAvailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Text render={<p />} size="base" tone="tertiary">
        Archive UI examples are only available in development builds.
      </Text>
    </div>
  );
}

export function ArchiveUiExamplePage() {
  if (!import.meta.env.DEV) {
    return <ArchiveUiExampleNotAvailable />;
  }
  return <ArchiveUiExampleGallery />;
}

function ArchiveUiExampleGallery() {
  useUiPickerScript();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-multi-editor">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-2">
          <Text render={<h1 />} size="xl" tone="primary" weight="medium">
            Archive placement demos
          </Text>
          <Text render={<p />} size="base" tone="tertiary">
            Twenty mock-only ideas for where the archived thread list could live. Nothing is wired
            into the app. Open{" "}
            <code className="text-multi-fg-secondary">/dev/archive-ui-example</code> and use the UI
            picker toolbar — labels are numbered 01–20. Demos 06–07 explore per-project and per-row
            toggles.
          </Text>
        </header>

        <section className="space-y-4 rounded-xl border border-multi-stroke-tertiary bg-multi-bg-elevated p-4 sm:p-5">
          <div className="space-y-1">
            <Text render={<h2 />} size="lg" tone="primary" weight="medium">
              Where should archive live?
            </Text>
            <Text render={<p />} size="sm" tone="tertiary">
              Production is 01 Settings. Browse all 20 with the picker; shortlist your favorites in
              chat.
            </Text>
          </div>
          <ArchivePlacementDemoGallery />
        </section>
      </div>
    </div>
  );
}
