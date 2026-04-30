/** Ten additional Cursor-class snapshots (subagent-sourced + tightened for this repo). */
export const cursorNativeGalleryExtensions = [
  {
    title: "AgentTrayPromptWrap",
    kind: "react snapshot",
    note: "Agent tray bottom shell: ui-agent-tray__prompt-wrap frames ui-prompt-input--agent-tray-stack (attachments + editor + footer).",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-agent-tray__prompt-wrap",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-prompt-input--agent-tray-stack",
    ],
  },
  {
    title: "UiSlashMenuContentGlass",
    kind: "react snapshot",
    note: "Glass slash palette body: ui-slash-menu__content--chrome with scrollable ui-slash-menu__list rows.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-slash-menu__content--chrome",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-slash-menu__item",
    ],
  },
  {
    title: "UiMentionMenuSidePreviewGlass",
    kind: "react snapshot",
    note: "Mention menu with side preview: ui-mention-menu-side-preview--chrome split list + preview (matches composer token menu grid).",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: mention menu glass",
      "packages/app/src/components/shell/composer/slash-menu.tsx :: ComposerTokenMenu",
    ],
  },
  {
    title: "UiGalleryGlassChrome",
    kind: "react snapshot",
    note: "Media gallery chrome: ui-gallery-shell-chrome header + scrollable grid shell.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: gallery glass",
      "packages/app/src/components/shell/composer/chat.tsx :: image lightbox references",
    ],
  },
  {
    title: "ModelPickerPreviewFrame",
    kind: "react snapshot",
    note: "chrome-model-picker-wrapper host + ui-model-picker__trigger + anchored listbox (structural mock).",
    files: [
      "packages/app/src/components/shell/pickers/model.tsx :: ModelPicker",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: model picker",
    ],
  },
  {
    title: "UiVibrancyStickyRoundedMask",
    kind: "react snapshot",
    note: "Sticky frosted strip with rounded mask: ui-vibrancy-sticky-rounded-mask (clip + backdrop blur).",
    files: [
      "packages/app/src/styles/glass.css :: --chrome-shell-blur",
      "packages/app/src/styles/tailwind.css :: mask utilities",
    ],
  },
  {
    title: "UiDefaultDiffUnified",
    kind: "react snapshot",
    note: "Unified diff view: ui-default-diff with line numbers, gutter indicators (+/-), inline word-level highlights (ui-default-diff__inline--added/removed), hunk separators, and range selection.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-default-diff / .ui-default-diff__line / .ui-default-diff__line--add / .ui-default-diff__line--removed",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-default-diff__inline--added / .ui-default-diff__inline--removed / .ui-default-diff__separator",
    ],
  },
  {
    title: "UiDefaultDiffSplit",
    kind: "react snapshot",
    note: "Side-by-side split diff view: ui-default-diff--split with two panes, each showing its own line numbers and inline word-level highlights.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-default-diff--split / .ui-default-diff__split-panes / .ui-default-diff__split-pane",
    ],
  },
  {
    title: "PromptAttachmentComposerStrip",
    kind: "react snapshot",
    note: "Composer pending row: prompt-attachment flex strip + composer-image-thumbnail chips (see glass-attachment-styles).",
    files: [
      "packages/app/src/lib/glass-attachment-styles.ts",
      "packages/app/src/components/shell/composer/chat.tsx :: AttachmentStrip",
    ],
  },
  {
    title: "ShellToolCallFull",
    kind: "react snapshot",
    note: "Full shell tool call with body: ui-tool-call-card.ui-shell-tool-call__card header (icon-swap + description + summary + stop button) + body (scroll area with tokenized command + pre output).",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card / ui-tool-call-card__header / ui-tool-call-card__body",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-shell-tool-call__command / ui-shell-tool-call__token--command / ui-shell-tool-call__output",
    ],
  },
  {
    title: "ShellToolCallCompleted",
    kind: "react snapshot",
    note: "Completed shell tool call: header-only state with expand-button--collapsed chevron, no stop button.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card__expand-button--collapsed",
    ],
  },
  {
    title: "FileToolCardRead",
    kind: "react snapshot",
    note: "File read tool card: ui-tool-call-card header (description-row with read icon + path summary) + body with scroll area showing file content.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card / ui-tool-call-card__header / ui-shell-tool-call__description-row",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card__expand-button--expanded",
    ],
  },
  {
    title: "FileToolCardEdit",
    kind: "react snapshot",
    note: "File edit tool card: ui-tool-call-card header with edit icon + body showing inline diff lines.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card / ui-shell-tool-call__description-row",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .ui-default-diff__line",
    ],
  },
  {
    title: "AgentPanelToolStack",
    kind: "react snapshot",
    note: "Agent panel tool call stack: [data-component=agent-panel] wrapping agent-panel-meta-agent-chat__row--tool-call rows with ui-tool-call-card instances (shell + file).",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .agent-panel-meta-agent-chat__row--tool-call / .agent-panel-meta-agent-chat__tool-call-row",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js :: ui-tool-call-card / [data-component=agent-panel]",
    ],
  },
  {
    title: "McpToolCallBlock",
    kind: "react snapshot",
    note: "MCP tool call block: composer-mcp-tool-call-block with verb + tool name header and parameter display.",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .composer-mcp-tool-call-block / .mcp-header-verb / .mcp-header-tool-name",
    ],
  },
  {
    title: "ChatToolInvocation",
    kind: "react snapshot",
    note: "Chat tool invocation inline part: chat-tool-invocation-part with expandable tool-input-output-part (expando toggle + input-output section).",
    files: [
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .chat-tool-invocation-part / .tool-input-output-part",
      "/System/Volumes/Data/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css :: .chat-tool-hover",
    ],
  },
] as const;
