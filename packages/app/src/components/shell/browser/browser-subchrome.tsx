"use client";

import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowRotateClockwise,
  IconConsole,
  IconFeather,
} from "central-icons";
import type { FormEvent, MouseEventHandler, ReactNode, RefObject } from "react";

import { WorkbenchIconButton } from "@honk/honkkit/workbench-button";
import { WorkbenchChromeActionGroup, WorkbenchChromeRow } from "@honk/honkkit/workbench-chrome-row";

import { cn } from "~/lib/utils";

import { BrowserLocationBar } from "./browser-location-bar";
import { BrowserMoreMenu } from "./browser-more-menu";

function BrowserNavButton(props: {
  "aria-label": string;
  active?: boolean | undefined;
  children: ReactNode;
  disabled?: boolean | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  title?: string | undefined;
}) {
  return (
    <WorkbenchIconButton
      aria-label={props["aria-label"]}
      active={props.active}
      chrome="panel"
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </WorkbenchIconButton>
  );
}

export function BrowserWorkbenchSubChrome(props: {
  canGoBack: boolean;
  canGoForward: boolean;
  committedUrl: string;
  inputValue: string;
  isLoading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  locationPlaceholder: string;
  onBack: () => void;
  onClearBrowsingHistory: () => void;
  onClearCache: () => void;
  onClearCookies: () => void;
  onCopyUrl: () => void;
  onForward: () => void;
  onHardReload: () => void;
  onInputChange: (value: string) => void;
  onOpenDevTools: () => void;
  onReload: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTakeScreenshot: () => void;
}) {
  const reloadIcon = (
    <IconArrowRotateClockwise
      className={cn("size-4 shrink-0", props.isLoading && "opacity-0")}
      aria-hidden
    />
  );
  const hasPage = Boolean(props.committedUrl);

  return (
    <WorkbenchChromeRow gap="loose" variant="panel">
      <WorkbenchChromeActionGroup gap="sub">
        <BrowserNavButton aria-label="Back" disabled={!props.canGoBack} onClick={props.onBack}>
          <IconArrowLeft className="size-4 shrink-0" aria-hidden />
        </BrowserNavButton>
        <BrowserNavButton
          aria-label="Forward"
          disabled={!props.canGoForward}
          onClick={props.onForward}
        >
          <IconArrowRight className="size-4 shrink-0" aria-hidden />
        </BrowserNavButton>
        <div
          className="relative flex size-(--honk-workbench-action-size) shrink-0 items-center justify-center"
          data-loading={props.isLoading ? "true" : undefined}
        >
          <BrowserNavButton aria-label="Reload" disabled={!hasPage} onClick={props.onReload}>
            {reloadIcon}
          </BrowserNavButton>
          {props.isLoading ? (
            <span
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              <span className="size-3.5 animate-spin rounded-full border border-honk-stroke-tertiary border-t-honk-icon-primary" />
            </span>
          ) : null}
        </div>
      </WorkbenchChromeActionGroup>

      <BrowserLocationBar
        committedUrl={props.committedUrl}
        inputRef={props.inputRef}
        inputValue={props.inputValue}
        isLoading={props.isLoading}
        locationPlaceholder={props.locationPlaceholder}
        onInputChange={props.onInputChange}
        onSubmit={props.onSubmit}
      />

      <WorkbenchChromeActionGroup gap="sub">
        <BrowserNavButton aria-label="Browser agent" disabled title="Browser agent">
          <IconFeather className="size-4 shrink-0" aria-hidden />
        </BrowserNavButton>
        <BrowserNavButton
          aria-label="Open developer tools"
          disabled={!hasPage}
          onClick={props.onOpenDevTools}
          title="Open developer tools"
        >
          <IconConsole className="size-4 shrink-0" aria-hidden />
        </BrowserNavButton>
        <BrowserMoreMenu
          hasPage={hasPage}
          onClearBrowsingHistory={props.onClearBrowsingHistory}
          onClearCache={props.onClearCache}
          onClearCookies={props.onClearCookies}
          onCopyUrl={props.onCopyUrl}
          onHardReload={props.onHardReload}
          onTakeScreenshot={props.onTakeScreenshot}
        />
      </WorkbenchChromeActionGroup>
    </WorkbenchChromeRow>
  );
}
