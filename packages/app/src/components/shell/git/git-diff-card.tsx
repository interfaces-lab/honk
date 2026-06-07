"use client";
import { IconChevronRightMedium, IconClipboard, IconStepBack } from "central-icons";
import type { GitFilePatchResult } from "@multi/contracts";
import { type RefObject, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@multi/multikit/button";
import { Checkbox } from "@multi/multikit/checkbox";
import { WorkbenchIconButton } from "@multi/multikit/workbench-button";

import type { DiffRow } from "~/hooks/use-environment-git";
import { cn } from "~/lib/utils";
import { useMountEffect } from "~/hooks/use-mount-effect";

import { DiffViewer } from "./diff-viewer";
import { getGitFileTypeDescriptor, GitFileTypeSymbol } from "./git-file-type";
import { GitKindBadge } from "./git-kind-badge";
import { VsFileIcon } from "./vscode-file-icon";

function splitPath(path: string) {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { prefix: "", name: path };
  return { prefix: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

function isRenderablePatch(patch: GitFilePatchResult | null): patch is Extract<
  GitFilePatchResult,
  { kind: "patch" | "untracked" }
> {
  return (
    (patch?.kind === "patch" || patch?.kind === "untracked") && patch.patch.trim().length > 0
  );
}

export function GitDiffCard(props: {
  file: DiffRow;
  selected: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  patch: GitFilePatchResult | null;
  diffRequested: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  diffStyle: "unified" | "split";
  viewed: boolean;
  onToggleViewed: () => void;
  onRevert: () => void;
  requestPrefetchForIdRef: RefObject<(id: string) => void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const copyPath = () => {
    void navigator.clipboard.writeText(props.file.path);
    toast.success("Path copied");
  };

  const hasDiffBody = props.diffRequested || props.loaded || props.error !== null;
  const showLoading = props.diffRequested && (props.loading || (!props.loaded && !props.error));
  const toggleExpanded = () => props.onExpandedChange(!props.expanded);
  const toggleViewed = () => {
    props.onToggleViewed();
    props.onExpandedChange(false);
  };
  const renderablePatch = isRenderablePatch(props.patch);

  if (!props.error && renderablePatch && props.expanded) {
    return (
      <div
        ref={rootRef}
        data-diff-card-id={props.file.id}
        className={cn(
          "@container min-w-0 border-0 border-b border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) last:border-b-transparent",
          props.selected && "bg-(--multi-chat-surface-background)",
        )}
      >
        {props.expanded ? (
          <ExpandedGitDiffCardPrefetchObserver
            key={props.file.id}
            fileId={props.file.id}
            rootRef={rootRef}
            requestPrefetchForIdRef={props.requestPrefetchForIdRef}
          />
        ) : null}
        <DiffViewer
          filePatch={props.patch}
          path={props.file.path}
          state={props.file.state}
          prevPath={props.file.prevPath}
          diffStyle={props.diffStyle}
          renderCustomHeader={() => (
            <GitDiffCardHeader
              file={props.file}
              patch={props.patch}
              expanded={props.expanded}
              viewed={props.viewed}
              onCopyPath={copyPath}
              onRevert={props.onRevert}
              onToggleExpanded={toggleExpanded}
              onToggleViewed={toggleViewed}
            />
          )}
          className="min-h-0"
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-diff-card-id={props.file.id}
      className={cn(
        "@container flex min-h-0 min-w-0 select-none flex-col overflow-hidden border-0 border-b border-multi-workbench-panel-border-muted bg-(--multi-chat-surface-background) transition-colors last:border-b-transparent",
        props.selected && "bg-(--multi-chat-surface-background)",
      )}
    >
      {props.expanded ? (
        <ExpandedGitDiffCardPrefetchObserver
          key={props.file.id}
          fileId={props.file.id}
          rootRef={rootRef}
          requestPrefetchForIdRef={props.requestPrefetchForIdRef}
        />
      ) : null}
      <GitDiffCardHeader
        file={props.file}
        patch={props.patch}
        expanded={props.expanded}
        viewed={props.viewed}
        onCopyPath={copyPath}
        onRevert={props.onRevert}
        onToggleExpanded={toggleExpanded}
        onToggleViewed={toggleViewed}
      />
      {props.expanded && hasDiffBody ? (
        <div className="min-h-0 min-w-0 bg-(--multi-git-diff-editor-background) select-text">
          {showLoading ? (
            <div className="flex flex-col gap-2 p-3">
              <div className="h-3 w-full max-w-56 animate-pulse rounded bg-muted/35" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/28" />
            </div>
          ) : props.error ? (
            <div className="p-3 text-detail text-destructive/90">{props.error}</div>
          ) : (
            <DiffViewer
              filePatch={props.patch}
              path={props.file.path}
              state={props.file.state}
              prevPath={props.file.prevPath}
              diffStyle={props.diffStyle}
              className="min-h-0"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function GitDiffCardHeader(props: {
  readonly file: DiffRow;
  readonly patch: GitFilePatchResult | null;
  readonly expanded: boolean;
  readonly viewed: boolean;
  readonly onCopyPath: () => void;
  readonly onRevert: () => void;
  readonly onToggleExpanded: () => void;
  readonly onToggleViewed: () => void;
}) {
  const { prefix, name } = splitPath(props.file.path);
  const pathLabel = prefix ? `${name} ${prefix}` : name;
  const fileType = getGitFileTypeDescriptor({ path: props.file.path, patch: props.patch });

  return (
    <div
      className={cn(
        "group/git-diff-header flex min-h-[30px] w-full shrink-0 select-none flex-nowrap items-center gap-1.5 overflow-hidden border-b px-1.5 py-1 hover:bg-multi-workbench-toolbar-hover-wash",
        props.expanded ? "border-multi-git-diff-header-border" : "border-b-transparent",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={props.onToggleExpanded}
        className="group/git-diff-toggle h-auto min-w-0 flex-1 justify-start gap-1.5 overflow-hidden border-0 p-0 text-left shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
        aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.file.path}`}
        aria-expanded={props.expanded}
        title={props.file.path}
      >
        <span
          className="relative inline-flex size-4 shrink-0 items-center justify-center"
          aria-hidden
        >
          <span className="absolute inset-0 inline-flex items-center justify-center text-multi-icon-tertiary opacity-100 transition-opacity duration-100 ease-out group-hover/git-diff-header:opacity-0 group-hover/git-diff-toggle:opacity-0 motion-reduce:transition-none">
            <VsFileIcon path={props.file.path} className="size-4" />
          </span>
          <span className="absolute inset-0 inline-flex items-center justify-center text-multi-icon-tertiary opacity-0 transition-opacity duration-100 ease-out group-hover/git-diff-header:opacity-100 group-hover/git-diff-toggle:opacity-100 motion-reduce:transition-none">
            {props.expanded ? (
              <IconChevronRightMedium className="size-4 shrink-0 rotate-90" />
            ) : (
              <IconChevronRightMedium className="size-4 shrink-0" />
            )}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-nowrap items-center overflow-hidden text-body">
          <span className="block w-full max-w-full min-w-0 flex-1 overflow-hidden text-ellipsis font-normal whitespace-nowrap text-[color-mix(in_srgb,var(--foreground)_88%,transparent)]">
            {pathLabel}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-detail tabular-nums @max-[360px]:gap-1">
          {fileType ? <GitFileTypeSymbol descriptor={fileType} /> : null}
          {props.file.add > 0 ? (
            <span className="text-(--multi-diff-addition)">+{props.file.add}</span>
          ) : null}
          {props.file.del > 0 ? (
            <span className="text-(--multi-diff-deletion)">-{props.file.del}</span>
          ) : null}
        </span>
      </Button>
      <span className="inline-flex min-w-0 shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
        <WorkbenchIconButton
          onClick={props.onCopyPath}
          aria-label="Copy path"
          title="Copy path"
          chrome="panel"
        >
          <IconClipboard className="size-4 shrink-0" />
        </WorkbenchIconButton>
        <WorkbenchIconButton
          onClick={props.onRevert}
          aria-label="Discard changes"
          title="Discard changes"
          chrome="panel"
        >
          <IconStepBack className="size-4 shrink-0" />
        </WorkbenchIconButton>
        <span className="inline-flex min-h-(--multi-workbench-action-size) shrink-0 items-center gap-1 rounded-[5px] px-[3px] pr-1 text-detail text-[color-mix(in_srgb,var(--foreground)_58%,transparent)] hover:bg-(--multi-workbench-toolbar-hover-background) hover:text-foreground @max-[360px]:w-(--multi-workbench-action-size) @max-[360px]:justify-center @max-[360px]:px-[3px]">
          <Checkbox
            aria-label="Viewed"
            checked={props.viewed}
            onCheckedChange={props.onToggleViewed}
            className="size-4"
          />
          <span className="@max-[360px]:absolute @max-[360px]:size-px @max-[360px]:overflow-hidden @max-[360px]:whitespace-nowrap @max-[360px]:[clip-path:inset(50%)]">
            Viewed
          </span>
        </span>
        <GitKindBadge state={props.file.state} />
      </span>
    </div>
  );
}

function ExpandedGitDiffCardPrefetchObserver(props: {
  readonly fileId: string;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly requestPrefetchForIdRef: RefObject<(id: string) => void>;
}) {
  useMountEffect(() => {
    const el = props.rootRef.current;
    if (!el) return;

    let prefetched = false;
    const scrollRoot = el.closest(".git-diff-scroll-root");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || prefetched) continue;
          prefetched = true;
          props.requestPrefetchForIdRef.current(props.fileId);
          obs.disconnect();
          return;
        }
      },
      {
        root: scrollRoot instanceof HTMLElement ? scrollRoot : null,
        rootMargin: "600px 0px 480px 0px",
        threshold: 0,
      },
    );

    obs.observe(el);
    return () => obs.disconnect();
  });

  return null;
}
