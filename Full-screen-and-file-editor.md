## Cursor reference findings

From `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`:

- Cursor uses real editor infrastructure, not a fake code preview.
  - Composer editor input: `workbench.editor.composer.input`.
  - Chat-only editor group: `Chat Editors`, `workbench.parts.embeddedAuxBarEditor`, `.embedded-aux-bar-editor-container`, `isChatOnlyEditorPart`.
  - Real files route through editor/file services, with guards so files do not open into chat-only groups.
- The selection affordance is a Monaco content widget.
  - DOM: `div.cursorHoverWidget`, `div.buttonContainer`.
  - Button: `Add to Chat`.
  - Command: `aichat.newchataction`.
  - Underlying command path: `composer.startComposerPrompt2`.
  - Shortcut shown in UI: `Cmd/Ctrl+L`.
- Glass/editor-panel fullscreen commands exist.
  - `glass.enterEditorPanelFullscreen`, `glass.exitEditorPanelFullscreen`, `glass.toggleEditorPanelFullscreen`.
  - `glass.toggleFileTreeSidebar`, `glass.openFilesTab`, `glass.filesNavigateBack`, `glass.filesNavigateForward`.
- Cursor’s panel show/fullscreen control component (`YLp`) exposes:
  - `Show Panel` / `Hide Panel` button.
  - icon names `layout-sidebar-right` / `layout-sidebar-right-off`.
  - context menu item `Editor Panel Fullscreen` with icon `arrows-expand-simple`.
- Cursor also has classic workbench maximize actions:
  - `workbench.action.maximizeEditor`, `workbench.action.maximizeEditorHideSidebar`.
  - `workbench.action.toggleMaximizedPanel`.
  - `workbench.action.maximizeChatSize` / `toggleUnifiedMaximizeState()` hides sidebar, panel, and editor then restores a snapshot.

Implementation target: reproduce the user-facing behavior and layout, using Honk/HonkKit components and Monaco APIs. Do not copy Cursor source.

## Current Honk frontend map

- `packages/app/src/components/shell/files/panel.tsx`
  - only re-exports `ProjectFilesPanel`.
- `packages/app/src/components/shell/files/project-files-panel.tsx`
  - owns file tree state, preview history, open-file dialog, and renders `SourcePreview`.
- `packages/app/src/components/shell/files/source-preview.tsx`
  - read-only `@pierre/diffs/react` file preview.
- `packages/app/src/components/shell/files/project-file-tree.tsx`
  - file tree, context menu, external editor open.
- `packages/app/src/components/shell/shell/app.tsx`
  - `AppShell`, `RightAside`, layout sizing, `centerSurface="editor"` support already exists.
- `packages/app/src/components/shell/shell/right-workbench-layout.tsx`
  - secondary rail + preview content layout.
- `packages/app/src/components/shell/shell/right-workbench-header.tsx`
  - right workbench tabs/action island.
- `packages/app/src/stores/shell-panels-store.ts`
  - left/right panel open/width, right active tab, secondary rail state.
- `packages/contracts/src/project.ts`, `packages/server/src/project/ProjectFileSystem.ts`
  - existing read/write file APIs, currently preview-sized read and unconditional write.

## Frontend product shape

### User flows

1. **Click file in Files panel**
   - Opens the file in a real Monaco editor.
   - Chat center changes to editor surface when requested from the side panel.
   - The Files tab remains the navigator/rail, not just a preview panel.

2. **Use file panel as mini IDE**
   - File tree on the left rail.
   - Editor header with Cursor-like toolbar:
     - menu/list icon
     - search/open-file icon
     - back / forward
     - breadcrumbs (`.vscode > settings.json`)
     - overflow menu
     - fullscreen/maximize control
   - Monaco body with line numbers, bracket matching, selection highlight, find, goto line, undo/redo, save.

3. **Fullscreen / maximize side panels**
   - From the file panel control, choose `Editor Panel Fullscreen`.
   - The editor/file panel expands to the usable shell area.
   - Restore returns exact previous layout: left sidebar open/width, right panel open/width, active tab, secondary rail open/width, center mode.

4. **Selection Add to Chat**
   - Select text in Monaco.
   - Floating pill appears near selection: `Add to Chat ⌘L`.
   - Click or shortcut inserts a file mention with line range into the composer and returns focus to chat.

5. **Playground / iteration mode**
   - Feature-flagged route or dev command opens the editor against real project files.
   - Allows testing center editor, right panel editor, fullscreen, dirty saves, and Add to Chat without flipping default behavior immediately.

## Detailed implementation plan

### 1. Define editor state and layout state

Add `packages/app/src/stores/workspace-editor-store.ts`.

State model:

```ts
type WorkspaceEditorPlacement = "center" | "right-panel";
type WorkspaceEditorMode = "chat" | "file-editor";
type WorkspacePanelFullscreenTarget = "none" | "center-editor" | "right-workbench" | "files-panel";

interface WorkspaceFileEditorState {
  mode: WorkspaceEditorMode;
  placement: WorkspaceEditorPlacement;
  activePath: string | null;
  history: { index: number; paths: readonly string[] };
  openPaths: readonly string[];
  fullscreenTarget: WorkspacePanelFullscreenTarget;
  restoreSnapshot: WorkspaceLayoutRestoreSnapshot | null;
  pendingComposerInsertion: PendingComposerInsertion | null;
}
```

Keep this separate from `shell-panels-store.ts` to avoid bloating generic panel state with editor-specific concerns.

Add actions:

- `openFile({ workspaceKey, path, placement })`
- `closeEditor({ workspaceKey })`
- `navigateFileHistory({ workspaceKey, delta })`
- `setOpenPaths(...)`
- `enterFullscreen({ workspaceKey, target })`
- `exitFullscreen({ workspaceKey })`
- `toggleFullscreen(...)`
- `queueComposerInsertion(...)`
- `consumeComposerInsertion(...)`

Persist only UI-safe values:

- last active file per workspace
- open paths
- history
- fullscreen should not persist across app restart unless explicitly desired; default to restoring normal layout.

### 2. Add Monaco foundation

Install `monaco-editor` in `packages/app/package.json`.

Add worker setup:

- `packages/app/src/lib/monaco/workers.ts`
  - static Vite worker imports for editor/json/css/html/ts workers.
  - assign `globalThis.MonacoEnvironment.getWorker`.
- Update both build configs:
  - `packages/app/vite.config.ts`
  - `packages/desktop/electron.vite.config.ts`

Add theme bridge:

- `packages/app/src/lib/monaco/theme.ts`
  - define `honk-cursor-light` / `honk-cursor-dark` Monaco themes from existing palettes in `packages/app/src/lib/diff-rendering.ts`.
  - map editor colors to Honk tokens:
    - background: `--honk-workbench-editor-surface-background`
    - foreground: Honk foreground token
    - line numbers: current diff palette `editorLineNumber.foreground`
    - selection/current line: tokenized color-mix values.
- Apply on `useTheme().resolvedTheme` changes.
- Also respond to appearance font changes from `packages/app/src/lib/appearance-settings.ts`.

Add model registry:

- `packages/app/src/lib/monaco/project-models.ts`
  - URI scheme: `honk-project-file://<environmentId>/<encoded cwd>/<relativePath>` or a stable opaque workspace key.
  - model keyed by `(environmentId, cwd, relativePath)`.
  - create/update/dispose models safely.
  - store `lastSavedContents`, `lastReadRevision`, `dirty`.

### 3. Make project file saves editor-safe

Read `docs/effect-llms.md` before server Effect edits.

Contract changes:

- `packages/contracts/src/project.ts`
  - extend `ProjectReadFileResult` with revision metadata, e.g.:
    - `mtimeMs`
    - `readBytes`
    - keep `sizeBytes`
  - extend `ProjectWriteFileInput` with optional expected revision:
    - `expectedMtimeMs?: number`
    - `expectedSizeBytes?: number`

Server changes:

- `packages/server/src/project/ProjectFileSystem.ts`
  - return mtime from `stat`.
  - on write, if expected revision supplied, stat first and reject stale writes.
  - keep existing unconditional behavior for callers that do not pass expected revision.

Frontend write helper:

- `packages/app/src/lib/project-react-query.ts`
  - add write mutation helper or explicit invalidation helper.
  - invalidate `projectReadFileQueryOptions` and git status after save.

### 4. Build Cursor-style editor components

Add files:

- `packages/app/src/components/shell/files/project-file-editor-shell.tsx`
- `packages/app/src/components/shell/files/project-monaco-editor.tsx`
- `packages/app/src/components/shell/files/project-editor-toolbar.tsx`
- `packages/app/src/components/shell/files/project-editor-breadcrumbs.tsx`
- `packages/app/src/components/shell/files/project-editor-overflow-menu.tsx`
- `packages/app/src/components/shell/files/project-editor-selection-widget.tsx`
- optional CSS: `packages/app/src/styles/monaco-editor.css`, imported from `packages/app/src/styles/app.css`.

Toolbar target, matching Cursor screenshot:

- height aligns with `--honk-workbench-chrome-row-height`.
- left cluster:
  - file tree toggle (`glass.toggleFileTreeSidebar` analogue)
  - search/open-file command
  - back
  - forward
- middle:
  - breadcrumbs with chevrons and compact truncation.
- right:
  - save/dirty state
  - fullscreen/maximize
  - overflow menu.

Monaco options:

```ts
{
  automaticLayout: true,
  minimap: { enabled: false },
  lineNumbers: "on",
  glyphMargin: false,
  folding: true,
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, bracketPairs: true },
  scrollBeyondLastLine: false,
  renderWhitespace: "selection",
  wordWrap: "off",
  fontFamily: "var(--honk-font-mono)",
  fontSize: resolved code font size,
  lineHeight: resolved code line height,
  padding: { top: 12, bottom: 24 },
}
```

Cursor visual details to match:

- soft off-white/dark workbench background.
- gutter line numbers with muted color.
- current line highlight similar to screenshot.
- breadcrumb row separated by faint bottom border.
- Monaco body no custom file header.
- dirty dot or subtle marker near filename, not loud.
- selection `Add to Chat` popover as a compact rounded white/dark bubble with shortcut text.

### 5. Replace file preview with editor-capable surface

Refactor `packages/app/src/components/shell/files/project-files-panel.tsx`:

- Move `PreviewHistory` into the new workspace editor store or rename to editor history.
- Keep `OpenFileCommandDialog`, but route to editor open action.
- Replace `SourcePreview` with `ProjectFileEditorShell` when a file is selected.
- Keep `EmptyFilePreview` for no active file.
- Continue supporting right panel mode: if the user only opens Files tab and does not take over center, the editor can still render in the panel.

Keep `SourcePreview` only if needed for fallback/truncated/binary read-only states, or rename it to `ProjectFileReadOnlyPreview`.

### 6. Route center chat/editor mode

Modify `packages/app/src/components/shell-host.tsx`:

- Compute `workspaceEditorState` for `workspaceTarget.workspaceKey`.
- Wrap `center`:
  - chat mode: existing `<Outlet />` / chat route.
  - editor mode: `<ProjectCenterEditorSurface ... />`.
- Pass `centerSurface={editorMode ? "editor" : "chat"}` to `AppShell`.
- Pass editor callbacks to `ProjectFilesPanel`:
  - `onOpenFileInCenter`
  - `onOpenFileInPanel`
  - `onToggleEditorFullscreen`

Add `ProjectCenterEditorSurface`:

- renders Cursor-style editor toolbar and Monaco.
- has close/back-to-chat control.
- shows file tree rail optionally when fullscreen or when user toggles it.
- reuses the same model registry as right panel editor.

Important: Chat should remain mounted if feasible to avoid losing scroll/composer transient state. If full unmount is unavoidable, rely on existing persisted drafts and add pending insertion queue.

### 7. Fullscreen / maximize layout behavior

Implement as a first-class shell state, not ad-hoc CSS.

Add to `workspace-editor-store.ts`:

```ts
interface WorkspaceLayoutRestoreSnapshot {
  leftOpen: boolean;
  leftW: number;
  rightOpen: boolean;
  rightW: number;
  activeTab: WorkbenchTab;
  muted: boolean;
  secondaryRails: Record<string, SecondaryRailState>;
  editorMode: WorkspaceEditorMode;
  editorPlacement: WorkspaceEditorPlacement;
}
```

Modify `AppShell` / `RightAside`:

- Add optional prop `fullscreenTarget` or read via context.
- Root data attrs:
  - `data-shell-fullscreen-target="none|center-editor|right-workbench|files-panel"`
  - `data-shell-editor-mode="chat|file-editor"`
- CSS in `packages/app/src/styles/shell.css`:
  - `center-editor` fullscreen hides left and right panels visually/inert, center fills shell.
  - `right-workbench` fullscreen makes right aside absolute/inset and width `100%`, above center.
  - `files-panel` fullscreen shows Files tab + secondary rail + editor body as full shell workspace.
- Sash behavior:
  - disable resize handles while fullscreen.
  - restore previous widths on exit.

Cursor-parity control:

- In `RightWorkbenchHeader.trailing`, add a `Show Panel` / `Hide Panel` button + menu.
- For Files tab, menu contains `Editor Panel Fullscreen`.
- Also expose explicit keyboard commands:
  - `editorPanel.toggleFullscreen`
  - `editorPanel.exitFullscreen`
  - `files.toggleFileTree`
  - `files.navigateBack`
  - `files.navigateForward`

Keybinding changes:

- `packages/contracts/src/keybindings.ts`
  - add static commands.
- `packages/server/src/keybindings.ts`
  - add defaults, all configurable.
- `packages/app/src/keybindings.ts`
  - helpers for matching commands.

Do not hardcode `Cmd/Ctrl+...` checks.

### 8. Selection Add to Chat

Add Monaco content widget:

- `ProjectEditorSelectionWidget`
  - observes `editor.onDidChangeCursorSelection`.
  - only visible for non-empty selections.
  - calls `editor.addContentWidget(...)` and `editor.layoutContentWidget(...)`.
  - positions near the selection start/end similar to Cursor.

UI:

- button text: `Add to Chat`.
- shortcut label from keybindings, e.g. `shortcutLabelForCommand(keybindings, "editor.addSelectionToChat")`.
- compact floating bubble with shadow and border.

Data captured:

```ts
interface PendingComposerInsertion {
  type: "file-selection";
  path: string;
  label: string | null;
  lineStart: number;
  lineEnd: number;
  text: string;
}
```

Composer integration:

- Extend `ComposerInputHandle` in `packages/app/src/components/chat/composer/input-contract.ts`:
  - `insertMention(payload: ComposerMentionPayload): void` or `insertFileMention(...)`.
- Extend `packages/app/src/components/chat/composer/prompt-editor/types.ts` and prompt editor handle if needed.
- Use existing mention payload shape `{ path, label, lineStart, lineEnd }`.
- In `packages/app/src/components/chat/view/chat-view.tsx`, consume pending insertion and call composer handle after returning to chat.

Shortcut:

- add `editor.addSelectionToChat` command.
- when Monaco editor has focus and selection is non-empty, resolve command through keybindings.
- default can be Cursor-like `mod+l` only when `editorFocus && !terminalFocus`, but configurable.

### 9. File tabs / history / quick open

Cursor has stable tab IDs (`stable-file`, `editor-panel-group`). Honk first pass should implement lightweight tabs/history:

- `openPaths` array for current workspace.
- `activePath` marks active tab.
- preview vs durable tabs can be deferred, but design state so it can be added.
- quick open dialog reuses existing `OpenFileCommandDialog`, but open action targets active editor placement.
- back/forward uses the workspace editor history.
- overflow menu includes:
  - Save
  - Save As external? (optional)
  - Close Editor
  - Close Other Files
  - Reveal in File Tree
  - Open in External Editor
  - Editor Panel Fullscreen

### 10. Playground / “play around with it” path

Add a safe frontend-only rollout path:

- Feature flag setting or localStorage flag:
  - `honk.experimental.monacoFileEditor=true`.
- Command palette actions:
  - `Open experimental file editor`
  - `Toggle editor panel fullscreen`
  - `Open Files in center editor`
- Optional dev-only panel under existing dev/HonkKit surfaces:
  - show editor shell in fixed sample states:
    - no file
    - loading
    - dirty
    - conflict
    - fullscreen
    - selection widget visible.

This lets us tune the exact UI without making every Files click immediately replace chat for all users.

## Frontend file-by-file changes

### Add

- `packages/app/src/stores/workspace-editor-store.ts`
- `packages/app/src/lib/monaco/workers.ts`
- `packages/app/src/lib/monaco/theme.ts`
- `packages/app/src/lib/monaco/project-models.ts`
- `packages/app/src/components/shell/files/project-file-editor-shell.tsx`
- `packages/app/src/components/shell/files/project-monaco-editor.tsx`
- `packages/app/src/components/shell/files/project-editor-toolbar.tsx`
- `packages/app/src/components/shell/files/project-editor-breadcrumbs.tsx`
- `packages/app/src/components/shell/files/project-editor-selection-widget.tsx`
- `packages/app/src/components/shell/files/project-center-editor-surface.tsx`
- `packages/app/src/styles/monaco-editor.css`

### Change

- `packages/app/package.json`
- `packages/app/vite.config.ts`
- `packages/desktop/electron.vite.config.ts`
- `packages/app/src/styles/app.css`
- `packages/app/src/styles/shell.css`
- `packages/app/src/components/shell-host.tsx`
- `packages/app/src/components/shell/shell/app.tsx`
- `packages/app/src/components/shell/shell/right-workbench-header.tsx`
- `packages/app/src/components/shell/shell/right-workbench-layout.tsx`
- `packages/app/src/components/shell/files/project-files-panel.tsx`
- `packages/app/src/components/shell/files/project-file-tree.tsx`
- `packages/app/src/components/chat/view/chat-view.tsx`
- `packages/app/src/components/chat/composer/input-contract.ts`
- `packages/app/src/components/chat/composer/input.tsx`
- `packages/app/src/components/chat/composer/prompt-editor/index.tsx`
- `packages/contracts/src/keybindings.ts`
- `packages/server/src/keybindings.ts`
- `packages/app/src/keybindings.ts`
- `packages/contracts/src/project.ts`
- `packages/server/src/project/ProjectFileSystem.ts`
- `packages/app/src/lib/project-react-query.ts`

## Verification

Run:

- `pnpm run typecheck`

Manual frontend matrix:

- Web renderer and Electron renderer.
- Light and dark themes.
- Wide window, narrow window, side rail overlay breakpoint.
- Right Files panel normal mode.
- Center editor mode.
- Files panel fullscreen.
- Right workbench fullscreen.
- Enter/exit fullscreen restores previous layout exactly.
- Dirty file close/save flows.
- Stale write conflict.
- Add to Chat from single-line and multi-line selections.
- Composer insertion retains line ranges as mention chips.
- External Open in Editor still works from file tree context menu.

## Risks

- Monaco worker setup must work in both Vite web and Electron renderer.
- Fullscreen layout can conflict with existing shell width animation and inert/aria-hidden behavior.
- Keeping chat mounted while center editor is active may require CSS hiding instead of conditional rendering.
- Full Cursor parity can expand scope quickly; keep first milestone to one active editor group and one file tree.
- Save conflict metadata touches contracts/server even though this is user-facing frontend work.

## Non-goals for first milestone

- Full VS Code extension host.
- LSP, diagnostics, formatter integration, code actions.
- Multi-root editor groups/splits.
- Perfect parity with Cursor proprietary internals.
- Editing binary or very large files beyond the current read limits until streaming/chunked read is designed.
