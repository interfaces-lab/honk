import { useState } from "react";
import type { ComponentType, ReactNode } from "react";

import {
  composerAttachmentChip,
  composerAttachmentStrip,
  composerImageThumbnail,
} from "~/lib/chat-attachment-styles";
import { cn } from "~/lib/utils";

const css = `
[data-cursor-preview] {
  color: var(--foreground);
  font-family: var(--multi-font-ui, ui-sans-serif, system-ui, sans-serif);
}

/* Transcript shell + conversation vars (workbench.desktop.main — §6.7) */
[data-component="agent-panel"] .composer-messages-container {
  --composer-max-width: 43.875rem;
  opacity: 1;
  --conversation-text-font-size: 13px;
  --conversation-tool-font-size: 13px;
  --conversation-font-size: var(--conversation-tool-font-size, 13px);
  --conversation-classic-text-inset: 9px;
  --conversation-classic-block-inset: 9px;
  --conversation-multi-text-inset: 8px;
  --conversation-multi-block-inset: -8px;
  --conversation-text-inset: var(--conversation-multi-text-inset);
  --conversation-block-inset: var(--conversation-multi-block-inset);
  --conversation-tool-card-padding-x: 8px;
  --conversation-tool-card-padding-tight-x: calc(var(--conversation-tool-card-padding-x, 8px) - 2px);
  --card-border-color: color-mix(in srgb, var(--foreground) 14%, transparent);
  --card-border-radius: 8px;
}

/* Meta-agent chat row stack (workbench.desktop.main — research §13) */
[data-cursor-preview] .agent-panel-meta-agent-chat__row {
  display: flex;
  min-width: 0;
  width: 100%;
}

[data-cursor-preview] .agent-panel-meta-agent-chat__row--assistant,
[data-cursor-preview] .agent-panel-meta-agent-chat__row--human {
  box-sizing: border-box;
  padding-left: 0;
  padding-right: 0;
}

[data-cursor-preview] .agent-panel-meta-agent-chat__message-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  width: 100%;
  content-visibility: auto;
  contain-intrinsic-size: 96px;
}

[data-cursor-preview] .agent-panel-meta-agent-chat__assistant-markdown {
  box-sizing: border-box;
  font-size: var(--conversation-text-font-size, var(--conversation-font-size, 13px));
  line-height: 1.5;
  max-width: 100%;
  min-width: 0;
}

[data-cursor-preview] .agent-panel-meta-agent-chat__assistant-markdown code {
  overflow-wrap: anywhere;
  word-break: normal;
}

[data-cursor-preview]
  .agent-panel-meta-agent-chat__row--assistant
  .ui-meta-agent-assistant-message__body {
  min-width: 0;
}

[data-cursor-preview] .smart-review-panel {
  display: flex;
  flex-direction: column;
  padding: 0 32px;
  position: relative;
}

[data-cursor-preview] .smart-review-panel__header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 6px 0;
}

[data-cursor-preview] .smart-review-panel__header--no-tabs {
  padding-bottom: 18px;
}

[data-cursor-preview] .smart-review-panel__title-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 1px;
}

[data-cursor-preview] .smart-review-panel__title-row {
  align-items: center;
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  justify-content: flex-start;
}

[data-cursor-preview] .smart-review-panel__title-right-element {
  align-items: center;
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  margin-left: auto;
}

[data-cursor-preview] .smart-review-panel__title {
  color: var(--foreground);
  font-size: 17px;
  font-weight: 600;
  line-height: 22px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-cursor-preview] .smart-review-panel__external-link-icon {
  color: color-mix(in srgb, var(--foreground) 56%, transparent);
  cursor: pointer;
  margin-left: -4px;
  margin-top: 2px;
  opacity: 0.85;
}

[data-cursor-preview] .smart-review-panel__summary-text {
  color: color-mix(in srgb, var(--foreground) 92%, transparent);
  font-size: 13px;
  font-weight: 400;
  letter-spacing: -0.078px;
  line-height: 18px;
}

[data-cursor-preview] .smart-review-panel__summary-content {
  position: relative;
}

[data-cursor-preview] .smart-review-panel__summary-more-button {
  background: none;
  border: none;
  color: var(--primary);
  cursor: pointer;
  display: inline-block;
  font-size: 12px;
  margin-top: 4px;
  padding: 4px 0;
}

[data-cursor-preview] .smart-review-panel__summary-more-button:hover {
  text-decoration: underline;
}

[data-cursor-preview] .smart-review-panel__meta-row {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

[data-cursor-preview] .smart-review-panel__meta-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

[data-cursor-preview] .smart-review-panel__meta-section-content {
  align-items: center;
  display: flex;
  gap: 4px;
  min-height: 20px;
}

[data-cursor-preview] .smart-review-panel__changes-label {
  color: color-mix(in srgb, var(--foreground) 52%, transparent);
  font-size: 11px;
  font-weight: 500;
  line-height: 14px;
}

[data-cursor-preview] .smart-review-panel__changes-file-count {
  color: color-mix(in srgb, var(--foreground) 68%, transparent);
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}

[data-cursor-preview] .smart-review-panel__lines-changed-container {
  display: flex;
  gap: 2px;
}

[data-cursor-preview] .smart-review-panel__lines-changed {
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}

[data-cursor-preview] .smart-review-panel__lines-changed.added {
  color: var(--multi-diff-addition);
}

[data-cursor-preview] .smart-review-panel__lines-changed.removed {
  color: var(--multi-diff-deletion);
}

[data-cursor-preview] .smart-review-panel__divider {
  background: var(--cursor-stroke-tertiary, hsla(0, 0%, 8%, 0.07));
  height: 1px;
  margin: 0;
}

[data-cursor-preview] .smart-review-panel__header-tabs-container {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-top: 6px;
  padding: 8px 2px 12px;
}

[data-cursor-preview] .smart-review-panel__header-tabs,
[data-cursor-preview] .smart-review-panel__header-tabs-right {
  align-items: center;
  display: flex;
  gap: 4px;
}

[data-cursor-preview] .smart-review-panel__header-tab {
  align-items: center;
  border-radius: 4px;
  display: flex;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  padding: 2px 6px;
}

[data-cursor-preview] .smart-review-panel__header-tab.inactive {
  color: color-mix(in srgb, var(--foreground) 68%, transparent);
}

[data-cursor-preview] .smart-review-panel__header-tab.inactive:hover {
  background: color-mix(in srgb, var(--muted) 50%, transparent);
  cursor: pointer;
}

[data-cursor-preview] .smart-review-panel__header-tab.active {
  background: color-mix(in srgb, var(--muted) 85%, transparent);
  color: var(--foreground);
}

[data-cursor-preview] .review-changes-group__body {
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  padding: 0 0 0 18px;
}

[data-cursor-preview] .review-changes-find-widget-container {
  position: relative;
}

[data-cursor-preview] .review-changes-find-widget-container .simple-find-part-wrapper {
  max-width: 400px;
}

[data-cursor-preview] .simple-find-part-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--background) 92%, transparent);
  padding: 8px;
}

[data-cursor-preview] .simple-find-part-wrapper input {
  flex: 1;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
  line-height: 16px;
  padding: 4px 6px;
}

[data-cursor-preview] .findMatch,
[data-cursor-preview] .currentFindMatch {
  border-radius: 4px;
  padding: 1px 3px;
}

[data-cursor-preview] .findMatch {
  background-color: color-mix(in srgb, var(--amber-500, #f59e0b) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber-500, #f59e0b) 30%, transparent);
}

[data-cursor-preview] .currentFindMatch {
  background-color: color-mix(in srgb, var(--primary) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 32%, transparent);
}

[data-cursor-preview] .commit-message-textarea {
  background-color: color-mix(in srgb, var(--background) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: 6px;
  box-sizing: border-box;
  color: var(--foreground);
  font-family: inherit;
  font-size: 12px;
  line-height: 16px;
  min-height: 60px;
  overflow-y: auto;
  padding: 6px 8px;
  resize: none;
  width: 100%;
}

[data-cursor-preview] .review-changes-file-name {
  color: var(--foreground);
  flex-shrink: 0;
  font-size: 12px;
}

[data-cursor-preview] .review-changes-file-name,
[data-cursor-preview] .review-changes-path-prefix {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-cursor-preview] .review-changes-path-prefix {
  color: color-mix(in srgb, var(--foreground) 62%, transparent);
  direction: rtl;
  flex-shrink: 1;
  font-size: 11px;
  min-width: 0;
  opacity: 0.4;
}

[data-cursor-preview] .review-changes-path-prefix-inner {
  direction: ltr;
  unicode-bidi: embed;
}

[data-cursor-preview] .review-changes-selectable-cell {
  align-items: center;
  border-radius: 4px;
  color: var(--foreground);
  cursor: pointer;
  display: flex;
  font-size: 12px;
  gap: 6px;
  line-height: 16px;
  min-width: 0;
  padding: 4px;
  transition: background-color 0.1s ease;
}

[data-cursor-preview] .review-changes-selectable-cell:hover {
  background: color-mix(in srgb, var(--muted) 72%, transparent);
}

[data-cursor-preview] .chrome-in-app-menubar {
  align-items: stretch;
  background: color-mix(in srgb, var(--background) 92%, var(--muted));
  border-bottom: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  display: flex;
  flex-shrink: 0;
  height: 32px;
}

[data-cursor-preview] .chrome-in-app-menubar__menus {
  align-items: center;
  display: flex;
  flex-shrink: 0;
  gap: 1px;
  padding: 0 6px;
}

[data-cursor-preview] .chrome-in-app-menubar__drag-tail {
  flex: 1;
  min-width: 0;
}

[data-cursor-preview] .chrome-in-app-menubar__window-controls {
  align-items: stretch;
  display: flex;
  flex-shrink: 0;
}

[data-cursor-preview] .chrome-in-app-menubar__text-trigger,
[data-cursor-preview] .chrome-in-app-menubar__logo-btn {
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--foreground);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 4px 10px;
}

[data-cursor-preview] .chrome-in-app-menubar__text-trigger:hover,
[data-cursor-preview] .chrome-in-app-menubar__logo-btn:hover {
  background: color-mix(in srgb, var(--muted) 72%, transparent);
}

[data-cursor-preview] .chrome-in-app-menubar__shortcut {
  font-size: 11px;
  margin-left: 12px;
  opacity: 0.65;
  white-space: nowrap;
}

[data-cursor-preview] .chrome-window-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 8px;
}

[data-cursor-preview] .chrome-window-controls__button {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

[data-cursor-preview] .chrome-window-controls__button[data-kind='close'] {
  background: #ff5f57;
}

[data-cursor-preview] .chrome-window-controls__button[data-kind='minimize'] {
  background: #febc2e;
}

[data-cursor-preview] .chrome-window-controls__button[data-kind='maximize'] {
  background: #28c840;
}

[data-cursor-preview] .ui-shell-tool-call {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 94%, transparent);
  overflow: hidden;
  font-size: 13px;
}

[data-cursor-preview] .ui-shell-tool-call__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

[data-cursor-preview] .ui-shell-tool-call__summary {
  flex: 1;
  min-width: 0;
  color: var(--foreground);
  font-size: 13px;
  line-height: 18px;
}

[data-cursor-preview] .ui-shell-tool-call__header-actions-anchor {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

[data-cursor-preview] .ui-shell-tool-call__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

[data-cursor-preview] .ui-shell-tool-call__chrome-stop.ui-icon-button {
  position: relative;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--foreground) 80%, transparent);
}

[data-cursor-preview] .ui-shell-tool-call__chrome-stop-mark {
  position: absolute;
  left: 50%;
  top: 50%;
  box-sizing: border-box;
  width: 10px;
  aspect-ratio: 1;
  border-radius: 3px;
  background-color: var(--background);
  transform: translate(-50%, -50%);
}

[data-cursor-preview] .ui-shell-tool-call__menu {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  border-radius: 999px;
  padding: 2px 8px;
  color: color-mix(in srgb, var(--foreground) 70%, transparent);
  font-size: 12px;
}

[data-cursor-preview] .ui-shell-tool-call__skip-btn {
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--foreground) 78%, transparent);
  font-size: 12px;
  line-height: 16px;
}

[data-cursor-preview] .ui-agent-tray__prompt-wrap {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  min-width: 0;
  padding: 0 12px 10px;
  width: 100%;
}

[data-cursor-preview] .ui-prompt-input.ui-prompt-input--agent-tray-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

[data-cursor-preview] .ui-prompt-input__attachments-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

[data-cursor-preview] .ui-prompt-input__container {
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 92%, transparent);
  backdrop-filter: blur(10px);
}

[data-cursor-preview] .ui-prompt-input__editor {
  background: transparent;
  border: 0;
  box-sizing: border-box;
  color: var(--foreground);
  display: block;
  font: inherit;
  line-height: 20px;
  min-height: 40px;
  outline: none;
  padding: 10px 12px 6px;
  resize: none;
  width: 100%;
}

[data-cursor-preview] .ui-prompt-input__footer {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 0 10px 10px;
}

[data-cursor-preview] .ui-slash-menu__content--chrome {
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 94%, transparent);
  box-shadow: var(--multi-shadow-popup, 0 18px 48px hsla(0, 0%, 0%, 0.2));
  backdrop-filter: blur(24px);
  max-height: min(288px, 40vh);
  overflow: hidden;
  width: min(320px, calc(100vw - 2rem));
  font-size: 12px;
  line-height: 16px;
}

[data-cursor-preview] .ui-slash-menu__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  overflow-y: auto;
}

[data-cursor-preview] .ui-slash-menu__item {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: inherit;
  cursor: default;
  display: flex;
  gap: 6px;
  padding: 3px 4px;
  text-align: left;
  width: 100%;
}

[data-cursor-preview] .ui-slash-menu__item--active {
  background: color-mix(in srgb, var(--muted) 85%, transparent);
}

[data-cursor-preview] .ui-mention-menu-side-preview--chrome {
  display: grid;
  grid-template-columns: minmax(0, 12rem) minmax(0, 1fr);
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 94%, transparent);
  min-height: 140px;
  overflow: hidden;
  max-width: 420px;
}

[data-cursor-preview] .ui-mention-menu__list {
  border-right: 1px solid color-mix(in srgb, var(--foreground) 8%, transparent);
  overflow-y: auto;
  padding: 4px;
}

[data-cursor-preview] .ui-mention-menu__row {
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--foreground);
  cursor: default;
  display: block;
  font-size: 12px;
  padding: 6px 8px;
  text-align: left;
  width: 100%;
}

[data-cursor-preview] .ui-mention-menu__row--active {
  background: color-mix(in srgb, var(--muted) 80%, transparent);
}

[data-cursor-preview] .ui-mention-menu__preview {
  font-size: 11px;
  line-height: 14px;
  color: color-mix(in srgb, var(--foreground) 68%, transparent);
  padding: 8px;
  overflow: auto;
}

[data-cursor-preview] .ui-gallery-shell-chrome {
  display: flex;
  flex-direction: column;
  min-height: 120px;
  max-width: 400px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  overflow: hidden;
}

[data-cursor-preview] .ui-gallery-shell-chrome__header {
  align-items: center;
  display: flex;
  height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--foreground) 8%, transparent);
  font-size: 13px;
  font-weight: 500;
}

[data-cursor-preview] .ui-gallery-shell-chrome__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
}

[data-cursor-preview] .ui-gallery-shell-chrome__tile {
  aspect-ratio: 1;
  border-radius: 8px;
  background: color-mix(in srgb, var(--muted) 50%, transparent);
}

[data-cursor-preview] .chrome-model-picker-wrapper {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

[data-cursor-preview] .ui-model-picker__trigger {
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: color-mix(in srgb, var(--foreground) 72%, transparent);
  font-size: 12px;
  cursor: default;
}

[data-cursor-preview] .chrome-model-picker__popover {
  position: absolute;
  left: 0;
  top: 100%;
  margin-top: 4px;
  z-index: 20;
  width: 240px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 96%, transparent);
  box-shadow: var(--multi-shadow-popup, 0 12px 32px hsla(0, 0%, 0%, 0.25));
  padding: 4px 0;
}

[data-cursor-preview] .chrome-model-picker__row {
  border: none;
  background: transparent;
  display: flex;
  width: 100%;
  padding: 6px 12px;
  font-size: 12px;
  text-align: left;
  color: var(--foreground);
  cursor: default;
}

[data-cursor-preview] .chrome-model-picker__row--active {
  background: color-mix(in srgb, var(--muted) 85%, transparent);
}

[data-cursor-preview] .ui-vibrancy-sticky-rounded-mask {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 70%, transparent);
  backdrop-filter: blur(12px);
  padding: 8px 10px;
  font-size: 12px;
}

/* ui-default-diff: Cursor's unified/split diff viewer */
/* ui-default-diff: Cursor light theme hex — charts.green #55A583, charts.red #E75E78 */
/* ui-default-diff: Cursor dark  theme hex — charts.green #3FA266, charts.red #E34671 */
[data-cursor-preview] .ui-default-diff {
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  background-color: var(--background);
}

[data-cursor-preview] .ui-default-diff__content {
  display: flex;
  flex-direction: column;
}

[data-cursor-preview] .ui-default-diff__line {
  display: flex;
  gap: 0;
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 18px;
}

[data-cursor-preview] .ui-default-diff__gutter {
  display: flex;
  flex-shrink: 0;
  padding: 0 2px;
}

[data-cursor-preview] .ui-default-diff__line-number {
  width: 2.5rem;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--foreground) 35%, transparent);
  text-align: right;
  padding-right: 6px;
  user-select: none;
}

[data-cursor-preview] .ui-default-diff__line-indicator {
  width: 1rem;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
  color: color-mix(in srgb, var(--foreground) 45%, transparent);
}

[data-cursor-preview] .ui-default-diff__line-code-area {
  flex: 1;
  min-width: 0;
  padding: 0 8px;
}

[data-cursor-preview] .ui-default-diff__line-content {
  white-space: pre-wrap;
  word-break: break-all;
}

/* added lines: gutter gets stronger green tint, code area gets subtler */
[data-cursor-preview] .ui-default-diff__line[data-type=added] .ui-default-diff__gutter {
  background: color-mix(in srgb, #55A583 12%, transparent);
}
[data-cursor-preview] .ui-default-diff__line[data-type=added] .ui-default-diff__line-code-area {
  background: color-mix(in srgb, #55A583 6%, transparent);
}
[data-cursor-preview] .ui-default-diff__line[data-type=added] .ui-default-diff__line-indicator {
  color: #55A583;
}

/* removed lines: gutter gets stronger red tint, code area gets subtler */
[data-cursor-preview] .ui-default-diff__line[data-type=removed] .ui-default-diff__gutter {
  background: color-mix(in srgb, #E75E78 12%, transparent);
}
[data-cursor-preview] .ui-default-diff__line[data-type=removed] .ui-default-diff__line-code-area {
  background: color-mix(in srgb, #E75E78 6%, transparent);
}
[data-cursor-preview] .ui-default-diff__line[data-type=removed] .ui-default-diff__line-indicator {
  color: #E75E78;
}

/* BEM fallbacks for old markup */
[data-cursor-preview] .ui-default-diff__line--add .ui-default-diff__gutter {
  background: color-mix(in srgb, #55A583 12%, transparent);
}
[data-cursor-preview] .ui-default-diff__line--add .ui-default-diff__line-code-area {
  background: color-mix(in srgb, #55A583 6%, transparent);
}
[data-cursor-preview] .ui-default-diff__line--add .ui-default-diff__line-indicator {
  color: #55A583;
}
[data-cursor-preview] .ui-default-diff__line--removed .ui-default-diff__gutter {
  background: color-mix(in srgb, #E75E78 12%, transparent);
}
[data-cursor-preview] .ui-default-diff__line--removed .ui-default-diff__line-code-area {
  background: color-mix(in srgb, #E75E78 6%, transparent);
}
[data-cursor-preview] .ui-default-diff__line--removed .ui-default-diff__line-indicator {
  color: #E75E78;
}

/* inline word-level highlights */
[data-cursor-preview] .ui-default-diff__inline--added {
  background: color-mix(in srgb, #55A583 22%, transparent);
  border-radius: 2px;
}
[data-cursor-preview] .ui-default-diff__inline--removed {
  background: color-mix(in srgb, #E75E78 22%, transparent);
  border-radius: 2px;
}

/* range selection */
[data-cursor-preview] .ui-default-diff__line--range-selected .ui-default-diff__line-code-area {
  background: color-mix(in srgb, #55A583 20%, var(--background));
  box-shadow: inset 3px 0 0 0 #55A583;
}
[data-cursor-preview] .ui-default-diff__line--range-selected .ui-default-diff__gutter {
  background: color-mix(in srgb, #55A583 16%, var(--background));
}

/* hunk separator */
[data-cursor-preview] .ui-default-diff__separator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  color: color-mix(in srgb, var(--foreground) 40%, transparent);
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}

[data-cursor-preview] .ui-default-diff__separator-text {
  opacity: 0.7;
}

[data-cursor-preview] .ui-default-diff__expand-btn {
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--foreground) 12%, transparent);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
  color: color-mix(in srgb, var(--foreground) 60%, transparent);
}

/* split pane diff */
[data-cursor-preview] .ui-default-diff__split-panes {
  display: flex;
}

[data-cursor-preview] .ui-default-diff__split-pane {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

[data-cursor-preview] .ui-default-diff__split-pane + .ui-default-diff__split-pane {
  border-left: 1px solid color-mix(in srgb, var(--foreground) 8%, transparent);
}

[data-cursor-preview] .composer-file-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--muted) 45%, transparent);
  font-size: 12px;
}

/*
 * Facsimile transcript lines (Cursor workbench class names not stable in survey;
 * rhythm matches Composer “explored” / footer activity text).
 */
[data-cursor-preview] .cursor-composer-explored-facsimile {
  font-size: 12px;
  line-height: 18px;
  color: color-mix(in srgb, var(--foreground) 46%, transparent);
  padding: 2px 0;
}

[data-cursor-preview] .cursor-composer-todo-facsimile {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
  color: color-mix(in srgb, var(--foreground) 55%, transparent);
  padding: 4px 0;
}

[data-cursor-preview] .cursor-composer-todo-facsimile__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  border: 1px solid color-mix(in srgb, var(--foreground) 22%, transparent);
  font-size: 10px;
  line-height: 1;
  color: color-mix(in srgb, var(--foreground) 50%, transparent);
}

[data-cursor-preview] .cursor-composer-markdown-facsimile {
  font-size: 14px;
  line-height: 1.55;
  color: color-mix(in srgb, var(--foreground) 92%, transparent);
}

[data-cursor-preview] .cursor-composer-markdown-facsimile code {
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--foreground) 7%, transparent);
}

[data-cursor-preview] .cursor-composer-footer-facsimile {
  font-size: 12px;
  line-height: 18px;
  color: color-mix(in srgb, var(--foreground) 44%, transparent);
  padding-top: 8px;
}

[data-cursor-preview] .cursor-composer-file-badge-ts {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  background: color-mix(in srgb, hsl(215 70% 50%) 22%, transparent);
  color: color-mix(in srgb, hsl(215 80% 42%) 100%, var(--foreground));
  flex-shrink: 0;
}

[data-cursor-preview] .ui-shell-tool-call__diff-stat-add {
  font-size: 12px;
  font-weight: 500;
  color: color-mix(in srgb, hsl(142 50% 36%) 100%, var(--foreground));
  margin-left: auto;
  padding-left: 8px;
  flex-shrink: 0;
}

[data-cursor-preview] .cursor-composer-code-block-facsimile {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: color-mix(in srgb, var(--foreground) 88%, transparent);
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}

[data-cursor-preview] .cursor-composer-code-block-facsimile .tok-kw {
  color: color-mix(in srgb, hsl(340 55% 48%) 90%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-code-block-facsimile .tok-fn {
  color: color-mix(in srgb, hsl(215 65% 48%) 95%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-code-block-facsimile .tok-str {
  color: color-mix(in srgb, hsl(28 70% 40%) 95%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-code-block-facsimile .tok-line-highlight {
  display: block;
  margin: 2px -12px;
  padding: 2px 12px;
  background: color-mix(in srgb, hsl(142 45% 42%) 12%, transparent);
  border-radius: 2px;
}

/* Composer “activity” lines (Grepped / Read / Thought) — facsimile of agent log rhythm */
[data-cursor-preview] .cursor-composer-activity-log {
  font-size: 12px;
  line-height: 18px;
  color: color-mix(in srgb, var(--foreground) 52%, transparent);
  padding: 2px 0;
  margin: 0;
}

[data-cursor-preview] .cursor-composer-activity-log__verb {
  font-weight: 500;
  color: color-mix(in srgb, var(--foreground) 62%, transparent);
  margin-right: 6px;
}

/* Thinking collapsible: bounded scroll + bottom fade (flush transcript; no assistant bubble card) */
[data-cursor-preview] .cursor-composer-thinking__trigger {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: color-mix(in srgb, var(--foreground) 58%, transparent);
  text-align: left;
  outline: none;
}

[data-cursor-preview] .cursor-composer-thinking__trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ring) 40%, transparent);
  outline-offset: 2px;
}

[data-cursor-preview] .cursor-composer-thinking__trigger--shimmer {
  background-image: linear-gradient(
    100deg,
    transparent 0%,
    transparent 40%,
    color-mix(in srgb, var(--foreground) 10%, transparent) 50%,
    transparent 60%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: cursor-composer-thinking-shimmer 1.6s ease-in-out infinite;
}

@keyframes cursor-composer-thinking-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-cursor-preview] .cursor-composer-thinking__trigger--shimmer {
    animation: none;
    background-image: none;
  }
}

[data-cursor-preview] .cursor-composer-thinking__chevron {
  display: flex;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--foreground) 45%, transparent);
  transition: transform 0.2s ease;
}

[data-cursor-preview] .cursor-composer-thinking__chevron[data-open="false"] {
  transform: rotate(-90deg);
}

[data-cursor-preview] .cursor-composer-thinking__panel {
  border: none;
}

[data-cursor-preview] .cursor-composer-thinking__scroll-clip {
  position: relative;
  max-height: 280px;
}

[data-cursor-preview] .cursor-composer-thinking__scroll {
  box-sizing: border-box;
  max-height: 280px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 2px 28px 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

[data-cursor-preview] .cursor-composer-thinking__scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

[data-cursor-preview] .cursor-composer-thinking__fade-stack {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 5.5rem;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease;
}

[data-cursor-preview] .cursor-composer-thinking__fade-stack[data-visible="true"] {
  opacity: 1;
}

[data-cursor-preview] .cursor-composer-thinking__fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Wider soft veil + light blur */
[data-cursor-preview] .cursor-composer-thinking__fade--layer-1 {
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--multi-chat-surface-background, var(--background)) 72%, transparent)
      0%,
    color-mix(in srgb, var(--multi-chat-surface-background, var(--background)) 18%, transparent)
      55%,
    transparent 100%
  );
  backdrop-filter: blur(4px) saturate(1.02);
  -webkit-backdrop-filter: blur(4px) saturate(1.02);
  mask-image: linear-gradient(to top, black 0%, black 22%, transparent 92%);
  -webkit-mask-image: linear-gradient(to top, black 0%, black 22%, transparent 92%);
}

/* Stronger blur anchored at the bottom edge */
[data-cursor-preview] .cursor-composer-thinking__fade--layer-2 {
  top: 38%;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--multi-chat-surface-background, var(--background)) 88%, transparent) 0%,
    transparent 100%
  );
  backdrop-filter: blur(18px) saturate(1.04);
  -webkit-backdrop-filter: blur(18px) saturate(1.04);
  mask-image: linear-gradient(to top, black 0%, black 45%, transparent 100%);
  -webkit-mask-image: linear-gradient(to top, black 0%, black 45%, transparent 100%);
}

[data-cursor-preview] .cursor-composer-thinking__prose {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: color-mix(in srgb, var(--foreground) 54%, transparent);
}

[data-cursor-preview] .cursor-composer-thinking__prose code {
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
  color: color-mix(in srgb, var(--foreground) 70%, transparent);
}

[data-cursor-preview] .cursor-composer-thinking__code {
  margin: 0;
  padding: 8px 0;
  border-radius: 0;
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: color-mix(in srgb, var(--foreground) 78%, transparent);
  background: transparent;
  border: none;
}

[data-cursor-preview] .cursor-composer-thinking__code .tok-kw {
  color: color-mix(in srgb, hsl(340 55% 46%) 95%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-thinking__code .tok-fn {
  color: color-mix(in srgb, hsl(215 62% 46%) 95%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-thinking__code .tok-str {
  color: color-mix(in srgb, hsl(28 65% 38%) 95%, var(--foreground));
}

[data-cursor-preview] .cursor-composer-thinking__code .tok-type {
  color: color-mix(in srgb, hsl(280 35% 48%) 90%, var(--foreground));
}

/* ui-tool-call-card: Cursor's real tool call card wrapper (from workbench.desktop.main.js) */
[data-cursor-preview] .ui-tool-call-card {
  border: none;
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  background: color-mix(in srgb, var(--background) 94%, transparent);
}

[data-cursor-preview] .ui-tool-call-card.ui-shell-tool-call__card {
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
}

[data-cursor-preview] .ui-tool-call-card__header {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 8px 10px;
  gap: 8px;
}

[data-cursor-preview] .ui-tool-call-card__body {
  border-top: 1px solid color-mix(in srgb, var(--foreground) 6%, transparent);
  padding: 0;
}

[data-cursor-preview] .ui-tool-call-card__expand-button {
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  height: 20px;
  justify-content: center;
  width: 20px;
  color: color-mix(in srgb, var(--foreground) 50%, transparent);
}

/* shell tool call: description row (icon swap + description + summary) */
[data-cursor-preview] .ui-shell-tool-call__description-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

[data-cursor-preview] .ui-shell-tool-call__icon-swap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--foreground) 55%, transparent);
}

[data-cursor-preview] .ui-shell-tool-call__description {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-cursor-preview] .ui-shell-tool-call__header-actions-spacer {
  width: 4px;
}

/* shell tool call: command tokens */
[data-cursor-preview] .ui-shell-tool-call__command {
  display: block;
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.6;
  padding: 6px 10px;
  white-space: pre-wrap;
  word-break: break-all;
}

[data-cursor-preview] .ui-shell-tool-call__prompt {
  color: color-mix(in srgb, var(--foreground) 40%, transparent);
  user-select: none;
}

[data-cursor-preview] .ui-shell-tool-call__token--command {
  color: var(--foreground);
  font-weight: 500;
}

[data-cursor-preview] .ui-shell-tool-call__token--text {
  color: color-mix(in srgb, var(--foreground) 85%, transparent);
}

[data-cursor-preview] .ui-shell-tool-call__token--whitespace {
  white-space: pre;
}

[data-cursor-preview] .ui-shell-tool-call__token--operator {
  color: color-mix(in srgb, var(--foreground) 55%, transparent);
}

/* shell tool call: output */
[data-cursor-preview] .ui-shell-tool-call__output {
  margin: 0;
  font-family: var(--multi-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 4px 10px 8px;
  color: color-mix(in srgb, var(--foreground) 75%, transparent);
}

/* scroll area */
[data-cursor-preview] .ui-scroll-area {
  overflow: hidden;
  position: relative;
}

[data-cursor-preview] .ui-scroll-area__viewport {
  overflow: auto;
}

[data-cursor-preview] .ui-scroll-area__content {
  min-width: 0;
}

/* agent panel message row for tool calls */
[data-cursor-preview] .agent-panel-meta-agent-chat__row--tool-call {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

[data-cursor-preview] .agent-panel-meta-agent-chat__tool-call-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* MCP tool call block */
[data-cursor-preview] .composer-mcp-tool-call-block {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent);
  background: color-mix(in srgb, var(--background) 94%, transparent);
  overflow: hidden;
  font-size: 13px;
}

[data-cursor-preview] .composer-mcp-tool-call-block .mcp-header-verb {
  color: color-mix(in srgb, var(--foreground) 55%, transparent);
  font-size: 13px;
}

[data-cursor-preview] .composer-mcp-tool-call-block .mcp-header-tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
}

[data-cursor-preview] .composer-mcp-tool-call-block .mcp-parameter-container {
  font-size: 13px;
  color: color-mix(in srgb, var(--foreground) 70%, transparent);
}

/* chat tool invocation (inline tool output in legacy/non-glass chat) */
[data-cursor-preview] .chat-tool-invocation-part {
  font-size: 13px;
}

[data-cursor-preview] .chat-tool-invocation-part .tool-input-output-part {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
}

[data-cursor-preview] .chat-tool-invocation-part .tool-input-output-part .input-output {
  display: none;
  flex-basis: 100%;
  padding: 6px 0;
  width: 100%;
}

[data-cursor-preview] .chat-tool-invocation-part .tool-input-output-part.expanded .input-output {
  display: inherit;
}

[data-cursor-preview] .chat-tool-invocation-part .tool-input-output-part .expando {
  align-items: center;
  cursor: pointer;
  display: flex;
  color: color-mix(in srgb, var(--foreground) 55%, transparent);
  font-size: 12px;
  gap: 4px;
}
`;

export function CursorNativeStyle() {
  return <style>{css}</style>;
}

function short(text: string, open: boolean, max = 180) {
  if (open || text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function SummaryText() {
  const [open, setOpen] = useState(false);
  const text =
    "Cursor's review panel summary uses compact metadata, a markdown summary block, and lightweight tabs to switch review surfaces without leaving the flow.";

  return (
    <div>
      <div className="smart-review-panel__summary-text">
        <div className="smart-review-panel__summary-content">{short(text, open)}</div>
      </div>
      <button
        className="smart-review-panel__summary-more-button"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Less" : "More"}
      </button>
    </div>
  );
}

function SummaryHead() {
  const [tab, setTab] = useState("Changes");
  const tabs = ["Overview", "Changes", "Comments"];

  return (
    <div className="smart-review-panel__header">
      <div className="smart-review-panel__title-section">
        <div className="smart-review-panel__title-row">
          <span className="smart-review-panel__title">Review Changes</span>
          <button className="smart-review-panel__external-link-icon" type="button">
            open
          </button>
          <div className="smart-review-panel__title-right-element">
            <span className="smart-review-panel__changes-file-count">PR #184</span>
          </div>
        </div>
        <SummaryText />
      </div>

      <div className="smart-review-panel__meta-row">
        <div className="smart-review-panel__meta-section smart-review-panel__changes-section">
          <span className="smart-review-panel__changes-label">Changes</span>
          <div className="smart-review-panel__meta-section-content">
            <span className="smart-review-panel__changes-file-count">12 files</span>
            <div className="smart-review-panel__lines-changed-container">
              <span className="smart-review-panel__lines-changed added">+248</span>
              <span className="smart-review-panel__lines-changed removed">-63</span>
            </div>
          </div>
        </div>
        <div className="smart-review-panel__meta-section">
          <span className="smart-review-panel__changes-label">Issues</span>
          <div className="smart-review-panel__meta-section-content">
            <span className="smart-review-panel__changes-file-count">3 found</span>
          </div>
        </div>
      </div>

      <div className="smart-review-panel__divider" />

      <div className="smart-review-panel__header-tabs-container">
        <div className="smart-review-panel__header-tabs">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              className={`smart-review-panel__header-tab ${tab === item ? "active" : "inactive"}`}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="smart-review-panel__header-tabs-right">
          <span className="smart-review-panel__changes-file-count">Diff</span>
        </div>
      </div>
    </div>
  );
}

function Cell(props: { prefix: string; name: string; right?: string }) {
  return (
    <div className="review-changes-selectable-cell">
      <span className="review-changes-path-prefix">
        <span className="review-changes-path-prefix-inner">{props.prefix}</span>
      </span>
      <span className="review-changes-file-name">{props.name}</span>
      {props.right ? <span className="chrome-in-app-menubar__shortcut">{props.right}</span> : null}
    </div>
  );
}

function Panel() {
  return (
    <div className="smart-review-panel">
      <SummaryHead />
      <div className="review-changes-group__body">
        <Cell
          prefix="packages/app/src/components/shell/debug/"
          name="cursor-composer-intents-feed.tsx"
          right="+120"
        />
        <Cell
          prefix="packages/app/src/components/shell/debug/"
          name="cursor-native-previews.tsx"
          right="+312"
        />
        <Cell
          prefix="packages/app/src/components/shell/debug/"
          name="debug-gallery-page.tsx"
          right="+48"
        />
      </div>
    </div>
  );
}

function Description() {
  return <SummaryText />;
}

function Selectable() {
  return (
    <div className="flex flex-col gap-3">
      <textarea
        className="commit-message-textarea"
        defaultValue="Render actual Cursor-shaped previews with original class names."
      />
      <div className="flex flex-col gap-1">
        <Cell prefix="packages/server/src/provider/" name="CodexAdapter.ts" right="Copy" />
        <Cell prefix="packages/app/src/components/shell/" name="chat/rows.tsx" right="Open" />
      </div>
    </div>
  );
}

function Find() {
  return (
    <div className="review-changes-find-widget-container">
      <div className="simple-find-part-wrapper">
        <input defaultValue="provider" />
        <span className="findMatch">7 matches</span>
        <span className="currentFindMatch">2 / 7</span>
      </div>
    </div>
  );
}

function Menubar() {
  const items = ["File", "Edit", "View", "Agent"];

  return (
    <div className="chrome-in-app-menubar" data-component="chrome-in-app-menubar">
      <div className="chrome-in-app-menubar__menus">
        <button className="chrome-in-app-menubar__logo-btn" type="button">
          Cursor
        </button>
        {items.map((item) => (
          <button key={item} className="chrome-in-app-menubar__text-trigger" type="button">
            {item}
          </button>
        ))}
        <span className="chrome-in-app-menubar__shortcut">cmd+k</span>
      </div>
      <div aria-hidden="true" className="chrome-in-app-menubar__drag-tail" />
      <div className="chrome-in-app-menubar__window-controls">
        <div className="chrome-window-controls">
          <span className="chrome-window-controls__button" data-kind="close" />
          <span className="chrome-window-controls__button" data-kind="minimize" />
          <span className="chrome-window-controls__button" data-kind="maximize" />
        </div>
      </div>
    </div>
  );
}

function Shell() {
  return (
    <div className="ui-shell-tool-call">
      <div className="ui-shell-tool-call__header">
        <div className="ui-shell-tool-call__summary">Running bash command in workspace</div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-icon-button ui-shell-tool-call__chrome-stop"
              data-variant="default"
              data-size="sm"
              aria-label="Stop command"
            >
              <span className="ui-shell-tool-call__chrome-stop-mark" aria-hidden />
            </button>
            <div className="ui-shell-tool-call__menu">Copy Command</div>
          </div>
          <button type="button" className="ui-shell-tool-call__skip-btn">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewAgentTray() {
  return (
    <div className="ui-agent-tray__prompt-wrap" data-component="agent-panel">
      <div className="ui-prompt-input ui-prompt-input--agent-tray-stack">
        <div className="ui-prompt-input__attachments-row">
          <span className="rounded-full border border-multi-border/40 px-2 py-0.5 text-caption text-muted-foreground">
            plan.md
          </span>
        </div>
        <div className="ui-prompt-input__container">
          <textarea
            readOnly
            className="ui-prompt-input__editor"
            placeholder="Ask in agent tray…"
            rows={2}
          />
          <div className="ui-prompt-input__footer">
            <div className="chrome-model-picker-wrapper">
              <button type="button" className="ui-model-picker__trigger">
                Model
              </button>
            </div>
            <span className="text-caption text-muted-foreground">Send</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSlashMenu() {
  const rows = [
    { id: "1", title: "plan", rest: "", desc: "Planning mode", active: true },
    { id: "2", title: "search", rest: "", desc: "Search workspace", active: false },
  ];
  return (
    <div className="ui-slash-menu__content--chrome" role="presentation">
      <div className="ui-slash-menu__list" role="listbox" aria-label="Slash">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            role="option"
            className={cn("ui-slash-menu__item", row.active && "ui-slash-menu__item--active")}
          >
            <span className="text-caption opacity-60">/</span>
            <span className="font-medium">{row.title}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {row.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewMention() {
  return (
    <div className="ui-mention-menu-side-preview--chrome" role="presentation">
      <div className="ui-mention-menu__list" role="listbox">
        <button type="button" className="ui-mention-menu__row ui-mention-menu__row--active">
          src/routes/api.ts
        </button>
        <button type="button" className="ui-mention-menu__row">
          src/lib/utils.ts
        </button>
      </div>
      <div className="ui-mention-menu__preview">
        <pre className="m-0 whitespace-pre-wrap font-multi-mono text-[11px]">{`export async function GET() {
  return json({ ok: true });
}`}</pre>
      </div>
    </div>
  );
}

function PreviewGalleryChrome() {
  return (
    <div className="ui-gallery-shell-chrome">
      <header className="ui-gallery-shell-chrome__header">Screenshots · 6</header>
      <div className="ui-gallery-shell-chrome__grid">
        <div className="ui-gallery-shell-chrome__tile" />
        <div className="ui-gallery-shell-chrome__tile" />
        <div className="ui-gallery-shell-chrome__tile" />
      </div>
    </div>
  );
}

function PreviewModelPicker() {
  return (
    <div className="chrome-model-picker-wrapper">
      <button type="button" className="ui-model-picker__trigger">
        GPT-5.2
      </button>
      <div className="chrome-model-picker__popover" role="listbox">
        <button type="button" className="chrome-model-picker__row chrome-model-picker__row--active">
          GPT-5.2
        </button>
        <button type="button" className="chrome-model-picker__row">
          Claude Opus
        </button>
      </div>
    </div>
  );
}

function PreviewVibrancyMask() {
  return (
    <div className="ui-vibrancy-sticky-rounded-mask">Sticky frosted header strip (mask + blur)</div>
  );
}

function PreviewDiff() {
  return (
    <div className="ui-default-diff">
      <div className="ui-default-diff__content">
        <div className="ui-default-diff__line" data-type="unchanged">
          <div className="ui-default-diff__gutter">
            <span className="ui-default-diff__line-number">1</span>
            <span className="ui-default-diff__line-number">1</span>
            <span className="ui-default-diff__line-indicator" />
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              import {"{"} twMerge {"}"} from &quot;tailwind-merge&quot;;
            </span>
          </div>
        </div>
        <div className="ui-default-diff__line" data-type="unchanged">
          <div className="ui-default-diff__gutter">
            <span className="ui-default-diff__line-number">2</span>
            <span className="ui-default-diff__line-number">2</span>
            <span className="ui-default-diff__line-indicator" />
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              import {"{"} clsx {"}"} from &quot;clsx&quot;;
            </span>
          </div>
        </div>
        <div className="ui-default-diff__line" data-type="removed">
          <div className="ui-default-diff__gutter" data-type="removed">
            <span className="ui-default-diff__line-number">3</span>
            <span className="ui-default-diff__line-number" />
            <span className="ui-default-diff__line-indicator">-</span>
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              export const <span className="ui-default-diff__inline--removed">v = 1</span>;
            </span>
          </div>
        </div>
        <div className="ui-default-diff__line" data-type="added">
          <div className="ui-default-diff__gutter" data-type="added">
            <span className="ui-default-diff__line-number" />
            <span className="ui-default-diff__line-number">3</span>
            <span className="ui-default-diff__line-indicator">+</span>
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              export const <span className="ui-default-diff__inline--added">v = 2</span>;
            </span>
          </div>
        </div>
        <div className="ui-default-diff__separator">
          <span className="ui-default-diff__separator-text">@@ -7,3 +7,5 @@</span>
          <button type="button" className="ui-default-diff__expand-btn">
            Expand
          </button>
        </div>
        <div className="ui-default-diff__line" data-type="unchanged">
          <div className="ui-default-diff__gutter">
            <span className="ui-default-diff__line-number">7</span>
            <span className="ui-default-diff__line-number">7</span>
            <span className="ui-default-diff__line-indicator" />
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              export function cn(...inputs: ClassValue[]) {"{"}
            </span>
          </div>
        </div>
        <div
          className="ui-default-diff__line ui-default-diff__line--range-selected"
          data-type="added"
        >
          <div className="ui-default-diff__gutter" data-type="added">
            <span className="ui-default-diff__line-number" />
            <span className="ui-default-diff__line-number">8</span>
            <span className="ui-default-diff__line-indicator">+</span>
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">
              {"  "}return twMerge(clsx(inputs));
            </span>
          </div>
        </div>
        <div
          className="ui-default-diff__line ui-default-diff__line--range-selected"
          data-type="added"
        >
          <div className="ui-default-diff__gutter" data-type="added">
            <span className="ui-default-diff__line-number" />
            <span className="ui-default-diff__line-number">9</span>
            <span className="ui-default-diff__line-indicator">+</span>
          </div>
          <div className="ui-default-diff__line-code-area">
            <span className="ui-default-diff__line-content">{"}"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewDiffSplit() {
  return (
    <div className="ui-default-diff ui-default-diff--split">
      <div className="ui-default-diff__split-panes">
        <div className="ui-default-diff__split-pane">
          <div className="ui-default-diff__content">
            <div className="ui-default-diff__line" data-type="unchanged">
              <div className="ui-default-diff__gutter">
                <span className="ui-default-diff__line-number">1</span>
                <span className="ui-default-diff__line-indicator" />
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content">
                  import {"{"} cn {"}"} from &quot;./utils&quot;;
                </span>
              </div>
            </div>
            <div className="ui-default-diff__line" data-type="removed">
              <div className="ui-default-diff__gutter" data-type="removed">
                <span className="ui-default-diff__line-number">2</span>
                <span className="ui-default-diff__line-indicator">-</span>
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content">
                  export const <span className="ui-default-diff__inline--removed">version</span> =
                  1;
                </span>
              </div>
            </div>
            <div className="ui-default-diff__line" data-type="unchanged">
              <div className="ui-default-diff__gutter">
                <span className="ui-default-diff__line-number">3</span>
                <span className="ui-default-diff__line-indicator" />
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content" />
              </div>
            </div>
          </div>
        </div>
        <div className="ui-default-diff__split-pane">
          <div className="ui-default-diff__content">
            <div className="ui-default-diff__line" data-type="unchanged">
              <div className="ui-default-diff__gutter">
                <span className="ui-default-diff__line-number">1</span>
                <span className="ui-default-diff__line-indicator" />
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content">
                  import {"{"} cn {"}"} from &quot;./utils&quot;;
                </span>
              </div>
            </div>
            <div className="ui-default-diff__line" data-type="added">
              <div className="ui-default-diff__gutter" data-type="added">
                <span className="ui-default-diff__line-number">2</span>
                <span className="ui-default-diff__line-indicator">+</span>
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content">
                  export const <span className="ui-default-diff__inline--added">release</span> = 2;
                </span>
              </div>
            </div>
            <div className="ui-default-diff__line" data-type="unchanged">
              <div className="ui-default-diff__gutter">
                <span className="ui-default-diff__line-number">3</span>
                <span className="ui-default-diff__line-indicator" />
              </div>
              <div className="ui-default-diff__line-code-area">
                <span className="ui-default-diff__line-content" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewAttachmentStrip() {
  return (
    <div className={cn(composerAttachmentStrip, "prompt-attachment px-2 pt-2")}>
      <div className={cn(composerImageThumbnail, "composer-image-thumbnail")} />
      <div className={cn(composerAttachmentChip, "composer-file-chip")}>
        <span className="truncate">release-notes.md</span>
      </div>
    </div>
  );
}

export type CursorPreviewShellToolCallFullProps = {
  description?: string;
  summary?: string;
  output?: string;
  command?: ReactNode;
};

export function CursorPreviewShellToolCallFull(props: CursorPreviewShellToolCallFullProps = {}) {
  const description = props.description ?? "Run linter";
  const summary = props.summary ?? "cd, pnpm";
  const output =
    props.output ??
    `> @glass/monorepo@ lint /Users/workgyver/Developer/c-glass\nFinished in 267ms on 422 files with 150 rules using 12 threads.`;
  const command = props.command ?? (
    <code className="ui-shell-tool-call__command">
      <span className="ui-shell-tool-call__prompt">$ </span>
      <span className="ui-shell-tool-call__token--command">cd</span>
      <span className="ui-shell-tool-call__token--whitespace"> </span>
      <span className="ui-shell-tool-call__token--text">/Users/workgyver/Developer/c-glass</span>
      <span className="ui-shell-tool-call__token--whitespace"> </span>
      <span className="ui-shell-tool-call__token--operator">{"&&"}</span>
      <span className="ui-shell-tool-call__token--whitespace"> </span>
      <span className="ui-shell-tool-call__token--command">pnpm</span>
      <span className="ui-shell-tool-call__token--whitespace"> </span>
      <span className="ui-shell-tool-call__token--text">run</span>
      <span className="ui-shell-tool-call__token--whitespace"> </span>
      <span className="ui-shell-tool-call__token--text">lint</span>
    </code>
  );
  return (
    <div className="ui-tool-call-card ui-shell-tool-call__card" data-has-content="true">
      <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
        <div className="ui-shell-tool-call__description-row">
          <span className="ui-shell-tool-call__icon-swap">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 9l3-3-3-3-.7.7L7.6 6 5.3 8.3z" />
              <path d="M9 11H4v1h5z" />
            </svg>
          </span>
          <span className="ui-shell-tool-call__description">{description}</span>
          <span className="ui-shell-tool-call__summary">{summary}</span>
        </div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <span className="ui-shell-tool-call__header-actions-spacer" />
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-icon-button ui-shell-tool-call__chrome-stop"
              data-variant="default"
              data-size="sm"
              aria-label="Stop command"
            >
              <span className="ui-shell-tool-call__chrome-stop-mark" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className="ui-tool-call-card__body">
        <div
          className="ui-scroll-area"
          data-visibility="hover"
          data-direction="vertical"
          style={{ maxHeight: 200 }}
        >
          <div className="ui-scroll-area__viewport">
            <div className="ui-scroll-area__content">
              {command}
              <pre className="ui-shell-tool-call__output">{output}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export type CursorPreviewShellToolCallCollapsedProps = {
  description?: string;
  summary?: string;
};

export function CursorPreviewShellToolCallCollapsed(
  props: CursorPreviewShellToolCallCollapsedProps = {},
) {
  const description = props.description ?? "Run typecheck";
  const summary = props.summary ?? "pnpm run typecheck";
  return (
    <div className="ui-tool-call-card ui-shell-tool-call__card">
      <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
        <div className="ui-shell-tool-call__description-row">
          <span className="ui-shell-tool-call__icon-swap">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6 9l3-3-3-3-.7.7L7.6 6 5.3 8.3z" />
              <path d="M9 11H4v1h5z" />
            </svg>
          </span>
          <span className="ui-shell-tool-call__description">{description}</span>
          <span className="ui-shell-tool-call__summary">{summary}</span>
        </div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <span className="ui-shell-tool-call__header-actions-spacer" />
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-tool-call-card__expand-button ui-tool-call-card__expand-button--collapsed"
              aria-label="Expand"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.3 13.3l.7.7 5-5-5-5-.7.7L9.6 9z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewFileToolRead() {
  return (
    <div className="ui-tool-call-card" data-has-content="true">
      <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
        <div className="ui-shell-tool-call__description-row">
          <span className="ui-shell-tool-call__icon-swap">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.85 4.44l-3.28-3.3-.71.7 2.58 2.58H2v1h10.44l-2.58 2.58.71.7 3.28-3.3zM2.15 11.56l3.28 3.3.71-.7-2.58-2.58H14v-1H3.56l2.58-2.58-.71-.7-3.28 3.3z" />
            </svg>
          </span>
          <span className="ui-shell-tool-call__description">Read file</span>
          <span className="ui-shell-tool-call__summary">utils.ts</span>
        </div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <span className="ui-shell-tool-call__header-actions-spacer" />
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-tool-call-card__expand-button ui-tool-call-card__expand-button--expanded"
              aria-label="Collapse"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ transform: "rotate(90deg)" }}
              >
                <path d="M5.3 13.3l.7.7 5-5-5-5-.7.7L9.6 9z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="ui-tool-call-card__body">
        <div
          className="ui-scroll-area"
          data-visibility="hover"
          data-direction="vertical"
          style={{ maxHeight: 160 }}
        >
          <div className="ui-scroll-area__viewport">
            <div className="ui-scroll-area__content">
              <pre className="ui-shell-tool-call__output">{`export function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}`}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewFileToolEdit() {
  return (
    <div className="ui-tool-call-card" data-has-content="true">
      <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
        <div className="ui-shell-tool-call__description-row">
          <span className="ui-shell-tool-call__icon-swap">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-2.53.49.49L2.41 13.59zM5.38 10.72l-.7-.7L12.14 2.56l.7.7L5.38 10.72z" />
            </svg>
          </span>
          <span className="ui-shell-tool-call__description">Edit file</span>
          <span className="ui-shell-tool-call__summary">foo.ts</span>
        </div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <span className="ui-shell-tool-call__header-actions-spacer" />
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-tool-call-card__expand-button ui-tool-call-card__expand-button--expanded"
              aria-label="Collapse"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ transform: "rotate(90deg)" }}
              >
                <path d="M5.3 13.3l.7.7 5-5-5-5-.7.7L9.6 9z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="ui-tool-call-card__body">
        <div
          className="ui-scroll-area"
          data-visibility="hover"
          data-direction="vertical"
          style={{ maxHeight: 160 }}
        >
          <div className="ui-scroll-area__viewport">
            <div className="ui-scroll-area__content">
              <div className="flex flex-col gap-0.5" style={{ padding: "6px 10px" }}>
                <div
                  className="ui-default-diff__line"
                  style={{ color: "var(--multi-diff-deletion, hsl(0 70% 60%))" }}
                >
                  <span className="ui-default-diff__gutter" style={{ opacity: 0.5 }}>
                    3
                  </span>
                  <code>- export const v = 1;</code>
                </div>
                <div className="ui-default-diff__line ui-default-diff__line--add">
                  <span className="ui-default-diff__gutter">3</span>
                  <code>+ export const v = 2;</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Composer transcript file card (TS badge + vitest-style body) for /debug/intents feed. */
export function CursorPreviewFileToolEditComposerFeed() {
  return (
    <div className="ui-tool-call-card ui-shell-tool-call__card" data-has-content="true">
      <div
        className="ui-tool-call-card__header"
        style={{
          cursor: "pointer",
          background: "color-mix(in srgb, var(--foreground) 4%, transparent)",
        }}
      >
        <div
          className="ui-shell-tool-call__description-row"
          style={{ flex: 1, minWidth: 0, width: "100%" }}
        >
          <span className="cursor-composer-file-badge-ts">TS</span>
          <span
            className="ui-shell-tool-call__description"
            style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            chat-timeline.test.ts
          </span>
          <span className="ui-shell-tool-call__diff-stat-add">+78</span>
        </div>
        <div className="ui-shell-tool-call__header-actions-anchor">
          <span className="ui-shell-tool-call__header-actions-spacer" />
          <div className="ui-shell-tool-call__header-actions">
            <button
              type="button"
              className="ui-tool-call-card__expand-button ui-tool-call-card__expand-button--expanded"
              aria-label="Collapse"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ transform: "rotate(90deg)" }}
              >
                <path d="M5.3 13.3l.7.7 5-5-5-5-.7.7L9.6 9z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="ui-tool-call-card__body">
        <div
          className="ui-scroll-area"
          data-visibility="hover"
          data-direction="vertical"
          style={{ maxHeight: 220 }}
        >
          <div className="ui-scroll-area__viewport">
            <div className="ui-scroll-area__content">
              <pre className="cursor-composer-code-block-facsimile">
                <span className="tok-kw">import</span> {"{"} describe, expect, it {"}"}{" "}
                <span className="tok-kw">from</span>{" "}
                <span className="tok-str">&quot;vitest&quot;</span>;{"\n\n"}
                <span className="tok-fn">describe</span>(
                <span className="tok-str">&quot;chat timeline&quot;</span>, () =&gt; {"{"}
                {"\n "}
                <span className="tok-line-highlight">
                  <span className="tok-fn">it</span>(
                  <span className="tok-str">&quot;groups explored tools&quot;</span>, () =&gt; {"{"}
                  {"\n    "}
                  <span className="tok-fn">expect</span>(
                  <span className="tok-fn">buildChatRows</span>([])).toEqual([]);
                  {"\n  });\n"}
                </span>
                {"});"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewAgentPanelToolStack() {
  return (
    <div data-component="agent-panel" className="flex flex-col gap-2" style={{ padding: "0 4px" }}>
      <div className="agent-panel-meta-agent-chat__row--tool-call">
        <div className="agent-panel-meta-agent-chat__tool-call-row">
          <div className="ui-tool-call-card ui-shell-tool-call__card">
            <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
              <div className="ui-shell-tool-call__description-row">
                <span className="ui-shell-tool-call__icon-swap">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M6 9l3-3-3-3-.7.7L7.6 6 5.3 8.3z" />
                    <path d="M9 11H4v1h5z" />
                  </svg>
                </span>
                <span className="ui-shell-tool-call__description">Run lint</span>
                <span className="ui-shell-tool-call__summary">pnpm run lint</span>
              </div>
              <div className="ui-shell-tool-call__header-actions-anchor">
                <span className="ui-shell-tool-call__header-actions-spacer" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="agent-panel-meta-agent-chat__row--tool-call">
        <div className="agent-panel-meta-agent-chat__tool-call-row">
          <div className="ui-tool-call-card">
            <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
              <div className="ui-shell-tool-call__description-row">
                <span className="ui-shell-tool-call__icon-swap">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-2.53.49.49L2.41 13.59zM5.38 10.72l-.7-.7L12.14 2.56l.7.7L5.38 10.72z" />
                  </svg>
                </span>
                <span className="ui-shell-tool-call__description">Edit file</span>
                <span className="ui-shell-tool-call__summary">rows.tsx</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="agent-panel-meta-agent-chat__row--tool-call">
        <div className="agent-panel-meta-agent-chat__tool-call-row">
          <div className="ui-tool-call-card">
            <div className="ui-tool-call-card__header" style={{ cursor: "pointer" }}>
              <div className="ui-shell-tool-call__description-row">
                <span className="ui-shell-tool-call__icon-swap">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.85 4.44l-3.28-3.3-.71.7 2.58 2.58H2v1h10.44l-2.58 2.58.71.7 3.28-3.3zM2.15 11.56l3.28 3.3.71-.7-2.58-2.58H14v-1H3.56l2.58-2.58-.71-.7-3.28 3.3z" />
                  </svg>
                </span>
                <span className="ui-shell-tool-call__description">Read file</span>
                <span className="ui-shell-tool-call__summary">utils.ts</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewMcpToolCall() {
  return (
    <div className="composer-mcp-tool-call-block">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderBottom: "1px solid color-mix(in srgb, var(--foreground) 8%, transparent)",
        }}
      >
        <span className="ui-shell-tool-call__icon-swap">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14 2H8L6.5 3.5 8 5h6V2zM8 5v4H6V5L4.5 6.5 6 8v4h2V8l1.5-1.5L8 5z" />
          </svg>
        </span>
        <span className="mcp-header-verb">Called</span>
        <span className="mcp-header-tool-name">context7_search</span>
      </div>
      <div className="mcp-parameter-container" style={{ padding: "6px 10px", fontSize: 12 }}>
        <span style={{ opacity: 0.6 }}>query:</span> &quot;react hooks best practices&quot;
      </div>
    </div>
  );
}

function PreviewChatToolInvocation() {
  return (
    <div className="chat-tool-invocation-part">
      <div className="tool-input-output-part expanded">
        <div className="expando">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11 10H5.3l.7.7-3-3 3-3-.7.7H11z" />
          </svg>
          <span>Used tool: read_file</span>
        </div>
        <div className="input-output">
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--multi-font-mono, ui-monospace, monospace)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              color: "color-mix(in srgb, var(--foreground) 85%, transparent)",
            }}
          >{`{  "path": "src/lib/utils.ts" }\n\n→ export function cn(...inputs) { return twMerge(clsx(inputs)); }`}</pre>
        </div>
      </div>
    </div>
  );
}

const CURSOR_NATIVE_PREVIEWS = {
  ReviewChangesPanel: Panel,
  ReviewChangesSummaryHeader: SummaryHead,
  ReviewChangesMarkdownDescription: Description,
  ReviewChangesSelectableCell: Selectable,
  ReviewChangesFindWidget: Find,
  InAppMenubarPreview: Menubar,
  ShellToolCallHeaderActions: Shell,
  ShellToolCallFull: CursorPreviewShellToolCallFull,
  ShellToolCallCompleted: CursorPreviewShellToolCallCollapsed,
  FileToolCardRead: PreviewFileToolRead,
  FileToolCardEdit: PreviewFileToolEdit,
  AgentPanelToolStack: PreviewAgentPanelToolStack,
  McpToolCallBlock: PreviewMcpToolCall,
  ChatToolInvocation: PreviewChatToolInvocation,
  AgentTrayPromptWrap: PreviewAgentTray,
  UiSlashMenuContentGlass: PreviewSlashMenu,
  UiMentionMenuSidePreviewGlass: PreviewMention,
  UiGalleryGlassChrome: PreviewGalleryChrome,
  ModelPickerPreviewFrame: PreviewModelPicker,
  UiVibrancyStickyRoundedMask: PreviewVibrancyMask,
  UiDefaultDiffUnified: PreviewDiff,
  UiDefaultDiffSplit: PreviewDiffSplit,
  PromptAttachmentComposerStrip: PreviewAttachmentStrip,
} satisfies Record<string, ComponentType>;

export const cursorNativePreviewTitles = Object.keys(CURSOR_NATIVE_PREVIEWS);

export function CursorNativePreview(props: { title: string }) {
  const C = CURSOR_NATIVE_PREVIEWS[props.title as keyof typeof CURSOR_NATIVE_PREVIEWS];
  return C ? <C /> : null;
}
