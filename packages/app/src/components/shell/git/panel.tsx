"use client";

import type { GitFileImageResult, GitFilePatchResult } from "@honk/contracts";
import {
  type ChangeTypes,
  type CodeViewItem,
  type CodeViewLayout,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type LineAnnotation,
  processFile,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import {
  IconArrowUndoUp,
  IconBarsThree,
  IconCheckmark1,
  IconChevronRightMedium,
  IconDotGrid1x3Horizontal,
  IconFolderOpen,
  IconStudioDisplay1,
  IconStop,
} from "central-icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@honk/honkkit/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@honk/honkkit/menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@honk/honkkit/dialog";

import { formatGitActionErrorDescription } from "~/git/action-error-description";
import {
  type DiffRow,
  type GitPanelModel,
  useDiffStylePreference,
} from "~/hooks/use-environment-git";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  GIT_AGENT_ACTIONS,
  GIT_AGENT_ACTION_ORDER,
  GIT_AGENT_PRIMARY_ACTION,
  type GitAgentAction,
} from "~/lib/git-agent-actions";
import { toastManager } from "~/app/toast";
import { useGitViewed } from "~/hooks/use-git-viewed-state";
import { useTheme } from "~/hooks/use-theme";
import {
  buildPatchCacheKey,
  resolveDiffThemeName,
  WORKBENCH_CODE_UNSAFE_CSS,
  WORKBENCH_DIFF_LINE_HEIGHT,
} from "~/lib/diff-rendering";
import { cn } from "~/lib/utils";
import { shellPanelsActions, useSecondaryRail } from "~/stores/shell-panels-store";
import { GitChangesFileTree } from "./git-changes-file-tree";
import { GitDiffCardHeader } from "./git-diff-card";
import { GitImageView } from "./git-image-view";
import { WorkbenchChromeActionGroup, WorkbenchChromeRow } from "@honk/honkkit/workbench-chrome-row";
import { WorkbenchIconButton, workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";

type GitChangesFilter = "uncommitted" | "unstaged" | "staged" | "branch";
const GIT_CHANGES_FILTERS: readonly GitChangesFilter[] = [
  "uncommitted",
  "unstaged",
  "staged",
  "branch",
];

function isGitChangesFilter(value: string): value is GitChangesFilter {
  return (GIT_CHANGES_FILTERS as readonly string[]).includes(value);
}

const GIT_CHANGES_FILTER_LABELS: Record<GitChangesFilter, string> = {
  uncommitted: "Uncommitted",
  unstaged: "Unstaged",
  staged: "Staged",
  branch: "Branch",
};
const EMPTY_BRANCH_COMMIT_OPTIONS: readonly BranchCommitOption[] = [];
type GitImagePatchResult = Extract<GitFilePatchResult, { kind: "non_text" }> & {
  readonly fileType: "image";
};
interface GitCodeViewImageAnnotation {
  readonly kind: "image";
}
type GitCodeViewAnnotation = GitCodeViewImageAnnotation;
type GitCodeViewLineAnnotation =
  | LineAnnotation<GitCodeViewAnnotation>
  | DiffLineAnnotation<GitCodeViewAnnotation>;
type GitCodeViewItem = CodeViewItem<GitCodeViewAnnotation>;

interface BranchCommitOption {
  readonly id: string;
  readonly subject: string;
  readonly shortSha: string;
}

interface GitCodeViewRowMeta {
  readonly active: boolean;
  readonly error: string | null;
  readonly expanded: boolean;
  readonly file: DiffRow;
  readonly image: GitFileImageResult | null;
  readonly imageError: string | null;
  readonly imageLoaded: boolean;
  readonly imageLoading: boolean;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly patch: GitFilePatchResult | null;
  readonly viewed: boolean;
}

interface GitCodeViewData {
  readonly items: readonly GitCodeViewItem[];
  readonly metaById: ReadonlyMap<string, GitCodeViewRowMeta>;
}

interface GitCodeViewFileDiffCacheEntry {
  readonly signature: string;
  readonly fileDiff: FileDiffMetadata;
}

interface GitCodeViewItemCacheEntry {
  readonly signature: string;
  readonly item: GitCodeViewItem;
  readonly version: number;
}

const GIT_CODE_VIEW_DIFF_HEADER_HEIGHT = 32;
const GIT_IMAGE_ANNOTATION_LINE_NUMBER = 1;
const GIT_IMAGE_ANNOTATION: DiffLineAnnotation<GitCodeViewAnnotation> = {
  side: "additions",
  lineNumber: GIT_IMAGE_ANNOTATION_LINE_NUMBER,
  metadata: { kind: "image" },
};
const GIT_CODE_VIEW_LAYOUT = {
  paddingTop: 0,
  gap: 0,
  paddingBottom: 0,
} as const satisfies CodeViewLayout;
const GIT_CODE_VIEW_UNSAFE_CSS = `${WORKBENCH_CODE_UNSAFE_CSS}
  [data-diffs-header='custom'] {
    min-height: ${GIT_CODE_VIEW_DIFF_HEADER_HEIGHT}px;
    background-color: var(--honk-chat-surface-background);
    overflow: hidden;
  }

  [data-diffs-header='custom']::slotted(*) {
    width: 100%;
  }
`;

function showGitActionErrorToast(title: string, error: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: formatGitActionErrorDescription(error),
  });
}

function resolveGitPanelSelectedId(input: {
  readonly visibleFiles: readonly DiffRow[];
  readonly previousSelectedId: string | null;
  readonly focusId: string | null;
}): string | null {
  if (input.visibleFiles.length === 0) {
    return null;
  }
  if (input.focusId && input.visibleFiles.some((row) => row.id === input.focusId)) {
    return input.focusId;
  }
  if (
    input.previousSelectedId !== null &&
    input.visibleFiles.some((row) => row.id === input.previousSelectedId)
  ) {
    return input.previousSelectedId;
  }
  return input.visibleFiles[0]?.id ?? null;
}

export function GitPanel(props: {
  git: GitPanelModel;
  workspaceKey: string | null;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;

  switch (git.view.kind) {
    case "loading":
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-8 text-center">
          <p className="text-detail text-muted-foreground/72">Loading changes...</p>
        </div>
      );
    case "idle":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-body font-medium text-foreground/85">No workspace selected</p>
          <p className="max-w-xs text-detail text-muted-foreground/72">
            Open a workspace to review changes.
          </p>
        </div>
      );
    case "error":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-body font-medium text-destructive/90">Git error</p>
          <p className="max-w-xs text-detail text-muted-foreground/80">{git.view.message}</p>
        </div>
      );
    case "no-repo":
      return <GitPanelNoRepo git={git} />;
    case "clean":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="text-body font-medium text-foreground/85">Working tree clean</p>
          <p className="max-w-72 text-detail text-muted-foreground/72">
            No staged or unstaged changes in this repository.
          </p>
        </div>
      );
    case "changed":
      return (
        <GitPanelInner
          git={git}
          workspaceKey={props.workspaceKey}
          onAgentAction={props.onAgentAction}
          onStopAgentAction={props.onStopAgentAction}
          stoppingAgentAction={props.stoppingAgentAction}
          pendingAgentAction={props.pendingAgentAction}
        />
      );
    default: {
      const _exhaustive: never = git.view;
      return _exhaustive;
    }
  }
}

function GitPanelNoRepo({ git }: { git: GitPanelModel }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="flex flex-col gap-1 px-4 py-3">
        <p className="text-body font-medium text-foreground/85">No repository</p>
        <p className="max-w-72 text-detail text-muted-foreground/72">
          Initialize Git in this project to track changes and review diffs.
        </p>
      </div>
      <InitGitButton git={git} />
    </div>
  );
}

function InitGitButton({ git }: { git: GitPanelModel }) {
  const handleClick = () => {
    void git
      .init()
      .catch((error: unknown) => showGitActionErrorToast("Could not initialize Git", error));
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      className="bg-honk-active/40 text-body font-medium text-foreground hover:bg-honk-hover"
    >
      Init Git
    </Button>
  );
}

function GitPanelChangesRail({
  active,
  rows,
  selectedId,
  onSelect,
}: {
  active: boolean;
  rows: readonly DiffRow[];
  selectedId: string | null;
  onSelect: (file: DiffRow) => void;
}) {
  if (!active) {
    return null;
  }

  return (
    <GitChangesFileTree
      active={active}
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      className="no-drag min-h-0 min-h-36 flex-1 border-b-0 bg-transparent"
    />
  );
}

function isRenderablePatch(
  patch: GitFilePatchResult | null,
): patch is Extract<GitFilePatchResult, { kind: "patch" | "untracked" }> {
  return (patch?.kind === "patch" || patch?.kind === "untracked") && patch.patch.trim().length > 0;
}

function isGitImagePatch(
  patch: GitFilePatchResult | null | undefined,
): patch is GitImagePatchResult {
  return patch?.kind === "non_text" && patch.fileType === "image";
}

function gitRowChangeType(file: DiffRow, patch: GitFilePatchResult | null): ChangeTypes {
  if (patch?.kind === "rename_only" || file.state === "renamed") {
    return "rename-pure";
  }
  if (file.state === "added" || file.state === "untracked") {
    return "new";
  }
  if (file.state === "deleted") {
    return "deleted";
  }
  return "change";
}

function createHeaderOnlyFileDiff(
  file: DiffRow,
  patch: GitFilePatchResult | null,
): FileDiffMetadata {
  const cacheKey = [
    "git-panel-header",
    file.id,
    file.path,
    file.prevPath ?? "",
    file.state,
    patch?.kind ?? "none",
  ].join(":");
  const prevName = file.prevPath ?? undefined;

  return {
    name: file.path,
    ...(prevName !== undefined ? { prevName } : {}),
    type: gitRowChangeType(file, patch),
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: true,
    deletionLines: [],
    additionLines: [],
    cacheKey,
  };
}

function createImageAnnotationFileDiff(
  file: DiffRow,
  patch: GitImagePatchResult,
): FileDiffMetadata {
  const cacheKey = [
    "git-panel-image",
    file.id,
    file.path,
    file.prevPath ?? "",
    file.state,
    patch.fileType,
  ].join(":");
  const prevName = file.prevPath ?? undefined;

  return {
    name: file.path,
    ...(prevName !== undefined ? { prevName } : {}),
    type: gitRowChangeType(file, patch),
    hunks: [
      {
        collapsedBefore: 0,
        additionStart: GIT_IMAGE_ANNOTATION_LINE_NUMBER,
        additionCount: 1,
        additionLines: 1,
        additionLineIndex: 0,
        deletionStart: 0,
        deletionCount: 0,
        deletionLines: 0,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: "change",
            deletions: 0,
            additions: 1,
            deletionLineIndex: 0,
            additionLineIndex: 0,
          },
        ],
        splitLineStart: 0,
        splitLineCount: 1,
        unifiedLineStart: 0,
        unifiedLineCount: 1,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
      },
    ],
    splitLineCount: 1,
    unifiedLineCount: 1,
    isPartial: true,
    deletionLines: [],
    // @pierre/diffs treats an empty concatenated side as no rendered line. Use a
    // newline-backed blank line so the synthetic image annotation row exists.
    additionLines: ["\n"],
    cacheKey,
  };
}

function normalizeParsedFileDiff(
  file: DiffRow,
  patch: Extract<GitFilePatchResult, { kind: "patch" | "untracked" }>,
  fileDiff: FileDiffMetadata,
  cacheKey: string,
): FileDiffMetadata {
  const prevName =
    file.prevPath ??
    (fileDiff.type === "rename-pure" || fileDiff.type === "rename-changed"
      ? fileDiff.prevName
      : undefined);

  return {
    ...fileDiff,
    name: file.path,
    ...(prevName !== undefined ? { prevName } : {}),
    type: patch.kind === "untracked" ? "new" : fileDiff.type,
    cacheKey,
  };
}

function resolveGitCodeViewFileDiff(
  file: DiffRow,
  patch: GitFilePatchResult | null,
  cache: Map<string, GitCodeViewFileDiffCacheEntry>,
): FileDiffMetadata {
  if (isGitImagePatch(patch)) {
    const signature = `image:${file.path}:${file.prevPath ?? ""}:${file.state}:${patch.fileType}`;
    const cached = cache.get(file.id);
    if (cached?.signature === signature) {
      return cached.fileDiff;
    }

    const fileDiff = createImageAnnotationFileDiff(file, patch);
    cache.set(file.id, { signature, fileDiff });
    return fileDiff;
  }

  if (!isRenderablePatch(patch)) {
    const signature = `header:${file.path}:${file.prevPath ?? ""}:${file.state}:${patch?.kind ?? "none"}`;
    const cached = cache.get(file.id);
    if (cached?.signature === signature) {
      return cached.fileDiff;
    }

    const fileDiff = createHeaderOnlyFileDiff(file, patch);
    cache.set(file.id, { signature, fileDiff });
    return fileDiff;
  }

  const patchText = patch.patch.trim();
  const cacheKey = buildPatchCacheKey(`${file.path}\0${patchText}`, "git-panel");
  const signature = `patch:${patch.kind}:${cacheKey}`;
  const cached = cache.get(file.id);
  if (cached?.signature === signature) {
    return cached.fileDiff;
  }

  const parsedFileDiff = processFile(patchText, {
    cacheKey,
    isGitDiff: true,
  });
  const fileDiff =
    parsedFileDiff === undefined
      ? createHeaderOnlyFileDiff(file, patch)
      : normalizeParsedFileDiff(file, patch, parsedFileDiff, cacheKey);
  cache.set(file.id, { signature, fileDiff });
  return fileDiff;
}

function buildGitCodeViewData(input: {
  readonly activeDiffIds: ReadonlySet<string>;
  readonly diffErrorByPath: ReadonlyMap<string, string>;
  readonly diffLoadingByPath: ReadonlySet<string>;
  readonly expandedIds: ReadonlySet<string>;
  readonly fileDiffCache: Map<string, GitCodeViewFileDiffCacheEntry>;
  readonly imageErrorByPath: ReadonlyMap<string, string>;
  readonly imageLoadingByPath: ReadonlySet<string>;
  readonly imagesByPath: ReadonlyMap<string, GitFileImageResult>;
  readonly itemCache: Map<string, GitCodeViewItemCacheEntry>;
  readonly patchesByPath: ReadonlyMap<string, GitFilePatchResult>;
  readonly viewedPaths: readonly string[];
  readonly visibleFiles: readonly DiffRow[];
}): GitCodeViewData {
  const items: GitCodeViewItem[] = [];
  const metaById = new Map<string, GitCodeViewRowMeta>();
  const viewedPathSet = new Set(input.viewedPaths);
  const seenIds = new Set<string>();

  for (const file of input.visibleFiles) {
    seenIds.add(file.id);
    const patch = input.patchesByPath.get(file.path) ?? null;
    const expanded = input.expandedIds.has(file.id);
    const active = input.activeDiffIds.has(file.id);
    const renderImageBody = active && expanded && isGitImagePatch(patch);
    const renderPatchBody = active && expanded && isRenderablePatch(patch);
    const fileDiff =
      renderPatchBody || renderImageBody
        ? resolveGitCodeViewFileDiff(file, patch, input.fileDiffCache)
        : createHeaderOnlyFileDiff(file, null);
    const collapsed = false;
    const bodyKind = renderImageBody ? "image" : renderPatchBody ? "patch" : "none";
    const itemSignature = `${fileDiff.cacheKey ?? file.id}:${bodyKind}:${collapsed ? "collapsed" : "expanded"}`;
    const cachedItem = input.itemCache.get(file.id);
    const item =
      cachedItem?.signature === itemSignature
        ? cachedItem.item
        : ({
            id: file.id,
            type: "diff",
            fileDiff,
            ...(renderImageBody ? { annotations: [GIT_IMAGE_ANNOTATION] } : {}),
            collapsed,
            version: (cachedItem?.version ?? -1) + 1,
          } satisfies GitCodeViewItem);

    if (cachedItem?.signature !== itemSignature) {
      input.itemCache.set(file.id, {
        signature: itemSignature,
        item,
        version: item.version ?? 0,
      });
    }

    items.push(item);
    metaById.set(file.id, {
      active,
      error: input.diffErrorByPath.get(file.path) ?? null,
      expanded,
      file,
      image: input.imagesByPath.get(file.path) ?? null,
      imageError: input.imageErrorByPath.get(file.path) ?? null,
      imageLoaded: input.imagesByPath.has(file.path),
      imageLoading: input.imageLoadingByPath.has(file.path),
      loaded: input.patchesByPath.has(file.path),
      loading: input.diffLoadingByPath.has(file.path),
      patch,
      viewed: viewedPathSet.has(file.path),
    });
  }

  for (const id of input.fileDiffCache.keys()) {
    if (!seenIds.has(id)) {
      input.fileDiffCache.delete(id);
    }
  }
  for (const id of input.itemCache.keys()) {
    if (!seenIds.has(id)) {
      input.itemCache.delete(id);
    }
  }

  return { items, metaById };
}

function gitHeaderStatus(meta: GitCodeViewRowMeta): {
  label: string;
  tone: "muted" | "danger";
} | null {
  if (meta.error !== null) {
    return { label: "Error", tone: "danger" };
  }
  if (meta.imageError !== null) {
    return { label: "Error", tone: "danger" };
  }
  if (meta.expanded && (meta.loading || meta.imageLoading)) {
    return { label: "Loading", tone: "muted" };
  }
  if (meta.patch?.kind === "rename_only") {
    return { label: "Rename", tone: "muted" };
  }
  if (meta.patch?.kind === "empty") {
    return { label: "No patch", tone: "muted" };
  }
  if (meta.patch?.kind === "large") {
    return { label: "Large", tone: "muted" };
  }
  if (meta.patch?.kind === "non_text") {
    return { label: meta.patch.fileType, tone: "muted" };
  }
  return null;
}

interface GitCodeViewHeaderProps {
  readonly meta: GitCodeViewRowMeta;
  readonly onCopyPath: (path: string) => void;
  readonly onExpandedChange: (id: string, open?: boolean) => void;
  readonly onRevert: (file: DiffRow) => void;
  readonly onToggleViewed: (path: string) => void;
  readonly requestDiff: (id: string) => void;
  readonly showViewed: boolean;
}

const GitCodeViewHeader = memo(function GitCodeViewHeader(props: GitCodeViewHeaderProps) {
  const { meta } = props;

  useEffect(() => {
    if (meta.expanded && (!meta.active || (!meta.loaded && !meta.loading)) && meta.error === null) {
      props.requestDiff(meta.file.id);
    }
  }, [
    meta.active,
    meta.error,
    meta.expanded,
    meta.file.id,
    meta.loaded,
    meta.loading,
    props.requestDiff,
  ]);

  const status = gitHeaderStatus(meta);
  const handleCopyPath = () => props.onCopyPath(meta.file.path);
  const handleRevert = () => props.onRevert(meta.file);
  const handleToggleExpanded = () => props.onExpandedChange(meta.file.id);
  const handleToggleViewed = () => {
    props.onToggleViewed(meta.file.path);
    props.onExpandedChange(meta.file.id, false);
  };

  return (
    <GitDiffCardHeader
      file={meta.file}
      patch={meta.patch}
      expanded={meta.expanded}
      viewed={meta.viewed}
      showViewed={props.showViewed}
      statusLabel={status?.label}
      statusTone={status?.tone}
      onCopyPath={handleCopyPath}
      onRevert={handleRevert}
      onToggleExpanded={handleToggleExpanded}
      onToggleViewed={handleToggleViewed}
    />
  );
}, areGitCodeViewHeaderPropsEqual);

function areGitCodeViewHeaderPropsEqual(
  previous: GitCodeViewHeaderProps,
  next: GitCodeViewHeaderProps,
): boolean {
  return (
    previous.showViewed === next.showViewed &&
    previous.onCopyPath === next.onCopyPath &&
    previous.onExpandedChange === next.onExpandedChange &&
    previous.onRevert === next.onRevert &&
    previous.onToggleViewed === next.onToggleViewed &&
    previous.requestDiff === next.requestDiff &&
    areGitCodeViewHeaderMetaEqual(previous.meta, next.meta)
  );
}

function areGitCodeViewHeaderMetaEqual(
  previous: GitCodeViewRowMeta,
  next: GitCodeViewRowMeta,
): boolean {
  return (
    previous.active === next.active &&
    previous.error === next.error &&
    previous.expanded === next.expanded &&
    previous.imageError === next.imageError &&
    previous.imageLoaded === next.imageLoaded &&
    previous.imageLoading === next.imageLoading &&
    previous.loaded === next.loaded &&
    previous.loading === next.loading &&
    previous.patch?.kind === next.patch?.kind &&
    getGitPatchFileType(previous.patch) === getGitPatchFileType(next.patch) &&
    previous.viewed === next.viewed &&
    previous.file.id === next.file.id &&
    previous.file.path === next.file.path &&
    previous.file.prevPath === next.file.prevPath &&
    previous.file.state === next.file.state &&
    previous.file.add === next.file.add &&
    previous.file.del === next.file.del
  );
}

function getGitPatchFileType(patch: GitFilePatchResult | null): string | null {
  return patch?.kind === "non_text" ? patch.fileType : null;
}

function GitPanelInner(props: {
  git: GitPanelModel;
  workspaceKey: string | null;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;
  const files = git.rows;
  const viewed = useGitViewed(git.cwd);
  const { open: gitRailOpen } = useSecondaryRail(props.workspaceKey, "git");
  const [diffStyle, setDiffStyle] = useDiffStylePreference();
  const [pending, setPending] = useState<DiffRow | null>(null);
  const [discardAllPending, setDiscardAllPending] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [changesFilter, setChangesFilter] = useState<GitChangesFilter>("uncommitted");
  const visibleFiles = useMemo(
    () =>
      changesFilter === "unstaged"
        ? files.filter((row) => row.unstaged)
        : changesFilter === "staged"
          ? files.filter((row) => row.staged)
          : files,
    [changesFilter, files],
  );
  const visibleTotals = useMemo(
    () =>
      visibleFiles.reduce(
        (totals, row) => ({
          add: totals.add + row.add,
          del: totals.del + row.del,
        }),
        { add: 0, del: 0 },
      ),
    [visibleFiles],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    resolveGitPanelSelectedId({
      visibleFiles,
      previousSelectedId: null,
      focusId: git.focusId,
    }),
  );

  useEffect(() => {
    setSelectedId((current) =>
      resolveGitPanelSelectedId({
        visibleFiles,
        previousSelectedId: current,
        focusId: git.focusId,
      }),
    );
  }, [git.focusId, visibleFiles]);
  const visiblePaths = useMemo(() => visibleFiles.map((row) => row.path), [visibleFiles]);
  const viewedPathSet = useMemo(() => new Set(viewed.viewed), [viewed.viewed]);
  const allVisibleFilesViewed =
    visibleFiles.length > 0 && visibleFiles.every((row) => viewedPathSet.has(row.path));
  const gitRef = useRef(git);
  gitRef.current = git;
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;

  const { resolvedTheme } = useTheme();
  const diffTheme = resolveDiffThemeName(resolvedTheme);
  const codeViewRef = useRef<CodeViewHandle<GitCodeViewAnnotation>>(null);
  const fileDiffCacheRef = useRef<Map<string, GitCodeViewFileDiffCacheEntry>>(new Map());
  const itemCacheRef = useRef<Map<string, GitCodeViewItemCacheEntry>>(new Map());
  const handleCodeViewContainerRef = useCallback((node: HTMLDivElement | null) => {
    node?.setAttribute("data-diffs-container", "");
  }, []);
  const codeViewOptions = useMemo(
    () =>
      ({
        theme: diffTheme,
        themeType: resolvedTheme,
        unsafeCSS: GIT_CODE_VIEW_UNSAFE_CSS,
        diffStyle,
        overflow: "wrap",
        disableBackground: false,
        disableLineNumbers: false,
        diffIndicators: "none",
        lineDiffType: "none",
        expandUnchanged: false,
        hunkSeparators: "simple",
        preferredHighlighter: "shiki-js",
        stickyHeaders: true,
        layout: GIT_CODE_VIEW_LAYOUT,
        itemMetrics: {
          lineHeight: WORKBENCH_DIFF_LINE_HEIGHT,
          diffHeaderHeight: GIT_CODE_VIEW_DIFF_HEADER_HEIGHT,
          spacing: 0,
        },
      }) satisfies CodeViewOptions<GitCodeViewAnnotation>,
    [diffStyle, diffTheme, resolvedTheme],
  );
  const codeViewData = useMemo(
    () =>
      buildGitCodeViewData({
        activeDiffIds: git.activeDiffIds,
        diffErrorByPath: git.diffErrorByPath,
        diffLoadingByPath: git.diffLoadingByPath,
        expandedIds: git.expandedIds,
        fileDiffCache: fileDiffCacheRef.current,
        imageErrorByPath: git.imageErrorByPath,
        imageLoadingByPath: git.imageLoadingByPath,
        imagesByPath: git.imagesByPath,
        itemCache: itemCacheRef.current,
        patchesByPath: git.patchesByPath,
        viewedPaths: viewed.viewed,
        visibleFiles,
      }),
    [
      git.diffErrorByPath,
      git.diffLoadingByPath,
      git.activeDiffIds,
      git.expandedIds,
      git.imageErrorByPath,
      git.imageLoadingByPath,
      git.imagesByPath,
      git.patchesByPath,
      viewed.viewed,
      visibleFiles,
    ],
  );
  const handleCopyPath = useCallback((path: string) => {
    void navigator.clipboard.writeText(path);
    toast.success("Path copied");
  }, []);
  const handleExpandedChange = useCallback((id: string, open?: boolean) => {
    gitRef.current.toggleExpand(id, open);
  }, []);
  const handleRevertFile = useCallback((file: DiffRow) => {
    setPending(file);
  }, []);
  const handleToggleViewed = useCallback((path: string) => {
    viewedRef.current.toggleViewed(path);
  }, []);
  const handleToggleAllViewed = useCallback(() => {
    if (visiblePaths.length === 0) return;
    if (allVisibleFilesViewed) {
      viewedRef.current.unmarkViewed(visiblePaths);
      return;
    }
    viewedRef.current.markAllViewed(visiblePaths);
  }, [allVisibleFilesViewed, visiblePaths]);
  const handleRequestDiff = useCallback((id: string) => {
    gitRef.current.requestDiff(id);
  }, []);
  const renderGitCodeViewAnnotation = useCallback(
    (annotation: GitCodeViewLineAnnotation, item: GitCodeViewItem) => {
      if (annotation.metadata.kind !== "image") {
        return null;
      }

      const meta = codeViewData.metaById.get(item.id);
      if (meta === undefined) {
        return null;
      }

      return (
        <GitImageView
          path={meta.file.path}
          patch={meta.patch}
          image={meta.image}
          loading={meta.imageLoading && !meta.imageLoaded}
          error={meta.imageError}
        />
      );
    },
    [codeViewData.metaById],
  );
  const renderGitCodeViewHeader = useCallback(
    (item: GitCodeViewItem) => {
      const meta = codeViewData.metaById.get(item.id);
      if (meta === undefined) {
        return null;
      }

      return (
        <GitCodeViewHeader
          meta={meta}
          onCopyPath={handleCopyPath}
          onExpandedChange={handleExpandedChange}
          onRevert={handleRevertFile}
          onToggleViewed={handleToggleViewed}
          requestDiff={handleRequestDiff}
          showViewed={changesFilter !== "branch"}
        />
      );
    },
    [
      codeViewData.metaById,
      changesFilter,
      handleCopyPath,
      handleExpandedChange,
      handleRequestDiff,
      handleRevertFile,
      handleToggleViewed,
    ],
  );

  const pendingDiscardPaths = pending === null ? null : [pending.path];

  const confirmDiscard = () => {
    if (pendingDiscardPaths === null) return;
    void git
      .discard(pendingDiscardPaths)
      .catch((error: unknown) => showGitActionErrorToast("Could not discard changes", error));
    setPending(null);
  };

  const confirmDiscardAll = () => {
    const allPaths = files.map((f) => f.path);
    void git
      .discard(allPaths)
      .catch((error: unknown) => showGitActionErrorToast("Could not discard changes", error));
    setDiscardAllPending(false);
  };

  const handleCommitAndPush = () => {
    if (props.pendingAgentAction) return;
    props.onAgentAction(GIT_AGENT_PRIMARY_ACTION);
  };

  const handleSelectFile = (file: DiffRow) => {
    git.requestDiff(file.id);
    setSelectedId(file.id);
  };

  const handleToggleRail = () => {
    shellPanelsActions.toggleSecondaryRail(props.workspaceKey, "git");
  };

  const handleDiscardAll = () => {
    setDiscardAllPending(true);
  };

  const handleRefresh = () => {
    void git.refresh();
  };

  const handlePendingDialogOpenChange = (open: boolean) => {
    if (!open) setPending(null);
  };

  const handleDiscardAllDialogOpenChange = (open: boolean) => {
    setDiscardAllPending(open);
  };

  const changesRail = (
    <GitPanelChangesRail
      active={gitRailOpen}
      rows={visibleFiles}
      selectedId={selectedId}
      onSelect={handleSelectFile}
    />
  );

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <LocalBranchBar
          railOpen={gitRailOpen}
          onToggleRail={handleToggleRail}
          branch={git.branch}
          onCommitAndPush={handleCommitAndPush}
          onAgentAction={props.onAgentAction}
          onStopAgentAction={props.onStopAgentAction}
          stoppingAgentAction={props.stoppingAgentAction}
          diffStyle={diffStyle}
          onDiffStyle={setDiffStyle}
          ignoreWhitespace={ignoreWhitespace}
          onIgnoreWhitespaceChange={setIgnoreWhitespace}
          editorMenuOpen={editorMenuOpen}
          onEditorMenuOpen={setEditorMenuOpen}
          commitMenuOpen={commitMenuOpen}
          onCommitMenuOpen={setCommitMenuOpen}
          pendingAgentAction={props.pendingAgentAction}
          onCollapseAll={git.collapseAll}
          onRefreshChanges={handleRefresh}
        />
        <ChangesHeader
          filter={changesFilter}
          onFilterChange={setChangesFilter}
          count={visibleFiles.length}
          totalAdd={visibleTotals.add}
          totalDel={visibleTotals.del}
          branchCommits={EMPTY_BRANCH_COMMIT_OPTIONS}
          allViewed={allVisibleFilesViewed}
          onDiscardAll={handleDiscardAll}
          onToggleAllViewed={handleToggleAllViewed}
        />
        <RightWorkbenchLayout
          workspaceKey={props.workspaceKey}
          tab="git"
          railOpen={gitRailOpen}
          railHostClassName="bg-(--honk-shell-sidebar-bg) shadow-[inset_-1px_0_0_color-mix(in_srgb,var(--honk-stroke-quaternary)_78%,transparent)]"
          rail={gitRailOpen ? changesRail : undefined}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--honk-workbench-editor-surface-background)">
            {selectedId ? (
              <SelectedGitDiffSync
                key={selectedId}
                selectedId={selectedId}
                codeViewRef={codeViewRef}
                gitRef={gitRef}
              />
            ) : null}
            {visibleFiles.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-detail text-muted-foreground/60">
                {changesFilter === "staged"
                  ? "No staged changes."
                  : changesFilter === "unstaged"
                    ? "No unstaged changes."
                    : "No files to compare."}
              </div>
            ) : (
              <CodeView<GitCodeViewAnnotation>
                ref={codeViewRef}
                containerRef={handleCodeViewContainerRef}
                items={codeViewData.items}
                className="git-diff-scroll-root web-component relative h-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-(--honk-git-diff-editor-background) px-0 pb-0 [contain:strict] [overflow-anchor:none] scrollbar-gutter-stable"
                options={codeViewOptions}
                renderAnnotation={renderGitCodeViewAnnotation}
                renderCustomHeader={renderGitCodeViewHeader}
              />
            )}
          </div>
        </RightWorkbenchLayout>
      </div>
      <DiscardDialog
        open={pending !== null}
        path={pending?.path ?? ""}
        onConfirm={confirmDiscard}
        onOpenChange={handlePendingDialogOpenChange}
      />
      <DiscardAllDialog
        open={discardAllPending}
        count={files.length}
        onConfirm={confirmDiscardAll}
        onOpenChange={handleDiscardAllDialogOpenChange}
      />
    </>
  );
}

function SelectedGitDiffSync(props: {
  readonly selectedId: string;
  readonly codeViewRef: { readonly current: CodeViewHandle<GitCodeViewAnnotation> | null };
  readonly gitRef: { readonly current: GitPanelModel };
}) {
  useMountEffect(() => {
    let settleFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      props.gitRef.current.toggleExpand(props.selectedId, true);

      const scrollMountedItem = (remainingFrames: number) => {
        const codeView = props.codeViewRef.current;
        if (codeView === null) {
          if (remainingFrames > 0) {
            settleFrame = requestAnimationFrame(() => scrollMountedItem(remainingFrames - 1));
          }
          return;
        }

        codeView.scrollTo({
          type: "item",
          id: props.selectedId,
          align: "nearest",
          behavior: "instant",
          offset: -8,
        });
      };
      settleFrame = requestAnimationFrame(() => scrollMountedItem(3));
    });

    return () => {
      cancelAnimationFrame(frame);
      if (settleFrame !== null) {
        cancelAnimationFrame(settleFrame);
      }
    };
  });

  return null;
}

function LocalBranchBarTrailing(props: {
  onCommitAndPush: () => void;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  diffStyle: "unified" | "split";
  onDiffStyle: (next: "unified" | "split") => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (next: boolean) => void;
  editorMenuOpen: boolean;
  onEditorMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  onCommitMenuOpen: (open: boolean) => void;
  pendingAgentAction: GitAgentAction | null;
  onCollapseAll: () => void;
  onRefreshChanges: () => void;
}) {
  const pendingActionDetails = props.pendingAgentAction
    ? GIT_AGENT_ACTIONS[props.pendingAgentAction]
    : null;
  const isAgentActionPending = props.pendingAgentAction !== null;
  const diffStyleLabel = props.diffStyle === "split" ? "Split" : "Unified";

  const handleDiffStyleChange = (value: string) => {
    if (value !== "unified" && value !== "split") return;
    props.onDiffStyle(value);
    props.onEditorMenuOpen(false);
  };
  const handleIgnoreWhitespaceChange = (checked: boolean | "indeterminate") => {
    props.onIgnoreWhitespaceChange(checked === true);
  };
  const handleCollapseAll = () => {
    props.onEditorMenuOpen(false);
    props.onCollapseAll();
  };
  const handleRefreshChanges = () => {
    props.onEditorMenuOpen(false);
    props.onRefreshChanges();
  };
  const handlePrimaryCommitAction = () => {
    if (isAgentActionPending) {
      props.onStopAgentAction?.();
      return;
    }
    props.onCommitMenuOpen(false);
    props.onCommitAndPush();
  };
  const handleCommitMenuOpenChange = (open: boolean) => {
    if (isAgentActionPending && open) return;
    props.onCommitMenuOpen(open);
  };

  return (
    <WorkbenchChromeActionGroup gap="sub">
      <div className="no-drag relative shrink-0">
        <Menu open={props.editorMenuOpen} onOpenChange={props.onEditorMenuOpen}>
          <MenuTrigger
            type="button"
            className={workbenchIconButtonVariants({ chrome: "panel" })}
            aria-label="Editor Options"
            title="Editor Options"
            data-active={false}
            data-chrome="panel"
            data-slot="workbench-icon-button"
            data-tab-system={false}
          >
            <IconDotGrid1x3Horizontal className="size-4" />
          </MenuTrigger>
          <MenuPopup
            align="end"
            className="min-w-56"
            positionerClassName="z-(--z-index-workbench-menu)"
            sideOffset={4}
            variant="workbench"
          >
            <MenuSub>
              <MenuSubTrigger variant="workbench">
                <span className="min-w-0 flex-1 truncate">Layout</span>
                <span className="shrink-0 text-honk-fg-tertiary">{diffStyleLabel}</span>
              </MenuSubTrigger>
              <MenuSubPopup
                className="min-w-44"
                positionerClassName="z-(--z-index-workbench-submenu)"
                sideOffset={6}
                variant="workbench"
              >
                <MenuRadioGroup value={props.diffStyle} onValueChange={handleDiffStyleChange}>
                  <MenuRadioItem value="unified" variant="workbench">
                    Unified
                  </MenuRadioItem>
                  <MenuRadioItem value="split" variant="workbench">
                    Split
                  </MenuRadioItem>
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
            <MenuCheckboxItem
              checked={props.ignoreWhitespace}
              onCheckedChange={handleIgnoreWhitespaceChange}
              variant="workbench-switch"
            >
              Ignore Whitespace
            </MenuCheckboxItem>
            <MenuSeparator className="my-1" variant="workbench" />
            <MenuItem disabled variant="workbench">
              <span className="min-w-0 flex-1 truncate">Find in Diff</span>
              <MenuShortcut variant="workbench">⌘F</MenuShortcut>
            </MenuItem>
            <MenuItem onClick={handleCollapseAll} variant="workbench">
              Collapse All
            </MenuItem>
            <MenuItem onClick={handleRefreshChanges} variant="workbench">
              <span className="min-w-0 flex-1 truncate">Refresh Changes</span>
              <MenuShortcut variant="workbench">⌘R</MenuShortcut>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <Menu open={props.commitMenuOpen} onOpenChange={handleCommitMenuOpenChange}>
        <div
          className="group no-drag inline-flex h-(--honk-workbench-action-size) min-w-0 select-none overflow-hidden rounded-honk-control border border-foreground/10 bg-foreground text-body font-medium text-background shadow-xs"
          data-pending={isAgentActionPending || undefined}
        >
          <Button
            type="button"
            variant="ghost"
            className="inline-flex h-full min-w-0 select-none items-center justify-center gap-(--honk-workbench-text-control-gap) rounded-none border-0 bg-transparent px-(--honk-workbench-text-control-padding-inline) text-inherit shadow-none before:hidden transition-colors hover:bg-background/10 hover:text-inherit disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
            disabled={
              isAgentActionPending &&
              (props.onStopAgentAction === null || props.stoppingAgentAction)
            }
            aria-busy={isAgentActionPending || undefined}
            aria-label={isAgentActionPending ? "Stop Git action" : undefined}
            onClick={handlePrimaryCommitAction}
          >
            {isAgentActionPending ? <IconStop className="size-3" /> : null}
            {props.stoppingAgentAction
              ? "Stopping..."
              : (pendingActionDetails?.loadingLabel ?? "Commit & Push")}
          </Button>
          <MenuTrigger
            type="button"
            className="inline-flex h-full w-6 shrink-0 select-none items-center justify-center border-l border-background/20 text-background transition-colors hover:bg-background/10 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent data-[popup-open]:bg-background/10"
            disabled={isAgentActionPending}
            aria-label="Open commit menu"
            title="Open commit menu"
          >
            <IconChevronRightMedium className="size-3 rotate-90" />
          </MenuTrigger>
        </div>
        <MenuPopup align="end" variant="workbench">
          {GIT_AGENT_ACTION_ORDER.map((action) => (
            <GitAgentActionMenuItem
              key={action}
              action={action}
              pendingAgentAction={props.pendingAgentAction}
              onAgentAction={props.onAgentAction}
              onCommitMenuOpen={props.onCommitMenuOpen}
            />
          ))}
        </MenuPopup>
      </Menu>
    </WorkbenchChromeActionGroup>
  );
}

function GitAgentActionMenuItem(props: {
  action: GitAgentAction;
  pendingAgentAction: GitAgentAction | null;
  onAgentAction: (action: GitAgentAction) => void;
  onCommitMenuOpen: (open: boolean) => void;
}) {
  const handleClick = () => {
    if (props.pendingAgentAction !== null) return;
    props.onAgentAction(props.action);
    props.onCommitMenuOpen(false);
  };

  return (
    <MenuItem onClick={handleClick} variant="workbench">
      {GIT_AGENT_ACTIONS[props.action].label}
    </MenuItem>
  );
}

function LocalBranchBar(props: {
  railOpen: boolean;
  onToggleRail: () => void;
  branch: string | null;
  onCommitAndPush: () => void;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  diffStyle: "unified" | "split";
  onDiffStyle: (next: "unified" | "split") => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (next: boolean) => void;
  editorMenuOpen: boolean;
  onEditorMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  onCommitMenuOpen: (open: boolean) => void;
  pendingAgentAction: GitAgentAction | null;
  onCollapseAll: () => void;
  onRefreshChanges: () => void;
}) {
  const copyBranch = () => {
    if (!props.branch) return;
    void navigator.clipboard.writeText(props.branch);
    toast.success("Branch copied");
  };
  const trailing = <LocalBranchBarTrailing {...props} />;

  return (
    <WorkbenchChromeRow gap="loose" variant="panel" trailing={trailing}>
      <WorkbenchIconButton
        onClick={props.onToggleRail}
        aria-label={props.railOpen ? "Hide changes list" : "Show changes list"}
        aria-pressed={props.railOpen}
        active={props.railOpen}
        title={props.railOpen ? "Hide changes list" : "Show changes list"}
        chrome="panel"
      >
        <IconBarsThree className="size-4 shrink-0" aria-hidden />
      </WorkbenchIconButton>
      <span className="inline-flex h-(--honk-workbench-action-size) shrink-0 items-center gap-1.5 rounded-full bg-honk-bg-tertiary px-2 text-body font-medium text-honk-fg-primary">
        <IconStudioDisplay1 className="size-3.5 shrink-0 text-honk-icon-secondary" aria-hidden />
        <span>Local</span>
      </span>
      <button
        type="button"
        onClick={copyBranch}
        className="no-drag inline-flex h-(--honk-workbench-action-size) min-w-0 select-none items-center justify-start overflow-hidden rounded-full border-0 bg-honk-bg-tertiary px-2 text-body font-medium text-honk-fg-tertiary outline-hidden transition-[background-color,color] hover:bg-honk-bg-secondary hover:text-honk-fg-primary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset"
        title="Copy branch name"
      >
        <span className="truncate">{props.branch ?? "detached"}</span>
      </button>
    </WorkbenchChromeRow>
  );
}

function ChangesHeaderTrailing(props: {
  allViewed: boolean;
  showViewAll: boolean;
  onDiscardAll: () => void;
  onToggleAllViewed: () => void;
}) {
  const viewAllLabel = props.allViewed ? "Unview all" : "View all";

  return (
    <WorkbenchChromeActionGroup gap="sub">
      <WorkbenchIconButton
        onClick={props.onDiscardAll}
        aria-label="Discard all changes"
        title="Discard all changes"
        chrome="panel"
      >
        <IconArrowUndoUp className="size-4 shrink-0" />
      </WorkbenchIconButton>
      {props.showViewAll ? (
        <WorkbenchIconButton
          onClick={props.onToggleAllViewed}
          aria-label={viewAllLabel}
          title={viewAllLabel}
          chrome="panel"
        >
          <span
            aria-hidden
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-honk-control border transition-colors",
              props.allViewed
                ? "border-primary bg-primary text-primary-foreground"
                : "border-honk-stroke-tertiary bg-honk-bg-quinary text-transparent",
            )}
          >
            <IconCheckmark1 className="size-3 shrink-0" />
          </span>
        </WorkbenchIconButton>
      ) : null}
    </WorkbenchChromeActionGroup>
  );
}

function ChangesHeader(props: {
  filter: GitChangesFilter;
  onFilterChange: (filter: GitChangesFilter) => void;
  count: number;
  totalAdd: number;
  totalDel: number;
  branchCommits: readonly BranchCommitOption[];
  allViewed: boolean;
  onDiscardAll: () => void;
  onToggleAllViewed: () => void;
}) {
  const trailing = (
    <ChangesHeaderTrailing
      allViewed={props.allViewed}
      showViewAll={props.filter !== "branch"}
      onDiscardAll={props.onDiscardAll}
      onToggleAllViewed={props.onToggleAllViewed}
    />
  );

  return (
    <WorkbenchChromeRow variant="panel" trailing={trailing}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <ChangesFilterMenu
          count={props.count}
          filter={props.filter}
          onFilterChange={props.onFilterChange}
        />
        {props.filter === "branch" ? (
          <BranchCommitFilterMenu commits={props.branchCommits} />
        ) : null}
        <ChangeTotals totalAdd={props.totalAdd} totalDel={props.totalDel} />
      </div>
    </WorkbenchChromeRow>
  );
}

function changeCountLabel(count: number, filter: GitChangesFilter): string {
  const changeWord = count === 1 ? "Change" : "Changes";
  if (filter === "branch") {
    return `${count} Branch ${changeWord}`;
  }
  return `${count} ${GIT_CHANGES_FILTER_LABELS[filter]} ${changeWord}`;
}

function changeFilterMenuItemLabel(filter: GitChangesFilter): string {
  if (filter === "branch") return "Branch Changes";
  return `${GIT_CHANGES_FILTER_LABELS[filter]} Changes`;
}

function ChangesFilterMenu(props: {
  count: number;
  filter: GitChangesFilter;
  onFilterChange: (filter: GitChangesFilter) => void;
}) {
  const label = changeCountLabel(props.count, props.filter);
  const handleFilterChange = (value: string) => {
    if (!isGitChangesFilter(value) || value === props.filter) return;
    props.onFilterChange(value);
  };

  return (
    <Menu>
      <MenuTrigger
        type="button"
        className="inline-flex h-(--honk-workbench-action-size) max-w-full min-w-0 select-none items-center justify-start gap-1.5 overflow-hidden rounded-honk-control border-0 bg-transparent px-1.5 text-body font-medium text-honk-fg-secondary shadow-none outline-hidden before:hidden transition-colors hover:bg-honk-bg-quaternary hover:text-honk-fg-primary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset"
        aria-label="Change filter"
      >
        <IconFolderOpen className="size-4 shrink-0 text-honk-icon-secondary" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <IconChevronRightMedium className="size-3 shrink-0 rotate-90 text-honk-icon-tertiary" />
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        <MenuRadioGroup value={props.filter} onValueChange={handleFilterChange}>
          {GIT_CHANGES_FILTERS.map((filter) => (
            <MenuRadioItem key={filter} value={filter} variant="workbench">
              {changeFilterMenuItemLabel(filter)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function BranchCommitFilterMenu(props: { commits: readonly BranchCommitOption[] }) {
  return (
    <Menu>
      <MenuTrigger
        type="button"
        className="inline-flex h-(--honk-workbench-action-size) max-w-40 min-w-0 select-none items-center justify-start gap-1.5 overflow-hidden rounded-honk-control border-0 bg-transparent px-1.5 text-body font-medium text-honk-fg-tertiary shadow-none outline-hidden before:hidden transition-colors hover:bg-honk-bg-quaternary hover:text-honk-fg-primary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset"
        aria-label="Commit filter"
      >
        <span className="min-w-0 truncate">All Commits</span>
        <IconChevronRightMedium className="size-3 shrink-0 rotate-90 text-honk-icon-tertiary" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className="min-w-80 rounded-[12px]"
        sideOffset={4}
        variant="workbench"
      >
        <MenuItem className="min-h-9 gap-3 px-3 py-1.5 text-body" variant="workbench">
          <span className="min-w-0 flex-1 truncate text-honk-fg-primary">All Commits</span>
          <IconCheckmark1 className="size-4 shrink-0 text-honk-fg-primary" />
        </MenuItem>
        {props.commits.map((commit) => (
          <MenuItem
            key={commit.id}
            className="min-h-9 gap-3 px-3 py-1.5 text-body"
            variant="workbench"
          >
            <span className="min-w-0 flex-1 truncate text-honk-fg-primary">{commit.subject}</span>
            <span className="shrink-0 font-honk-mono text-detail text-honk-fg-tertiary">
              {commit.shortSha}
            </span>
            <IconCheckmark1 className="size-4 shrink-0 text-honk-fg-primary" />
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function ChangeTotals(props: { totalAdd: number; totalDel: number }) {
  if (props.totalAdd === 0 && props.totalDel === 0) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-honk-mono text-body tabular-nums">
      {props.totalAdd > 0 ? (
        <span className="text-(--honk-diff-addition)">+{props.totalAdd}</span>
      ) : null}
      {props.totalDel > 0 ? (
        <span className="text-(--honk-diff-deletion)">-{props.totalDel}</span>
      ) : null}
    </span>
  );
}

function DiscardAllDialog(props: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const handleCancel = () => {
    props.onOpenChange(false);
  };
  const handleConfirm = () => {
    props.onConfirm();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard all changes?</DialogTitle>
          <DialogDescription>
            Revert all {props.count} file{props.count === 1 ? "" : "s"} to the last committed
            version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            Discard All
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DiscardDialog(props: {
  open: boolean;
  path: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const handleCancel = () => {
    props.onOpenChange(false);
  };
  const handleConfirm = () => {
    props.onConfirm();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>
            Revert <span className="font-mono text-foreground/90">{props.path}</span> to the last
            committed version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            Discard
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
