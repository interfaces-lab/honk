"use client";

import type { FormEvent, RefObject } from "react";
import { useState } from "react";

import { cn } from "~/lib/utils";

import { formatBrowserLocationSegments } from "./browser-url";

export function BrowserLocationBar(props: {
  committedUrl: string;
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  isLoading: boolean;
  locationPlaceholder: string;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [focused, setFocused] = useState(false);
  const displayUrl = props.committedUrl || props.inputValue;
  const segments = formatBrowserLocationSegments(displayUrl);
  const showSegmentDisplay = !focused && Boolean(props.committedUrl);

  const focusInput = () => {
    props.inputRef.current?.focus();
    props.inputRef.current?.select();
  };

  return (
    <form
      className={cn(
        "no-drag relative flex h-(--honk-workbench-action-size) min-w-0 flex-1 items-center overflow-hidden rounded-honk-control border-0 bg-transparent px-(--honk-workbench-text-control-padding-inline) text-honk-chrome shadow-none outline-hidden focus-within:ring-1 focus-within:ring-honk-stroke-focused focus-within:ring-inset",
        props.isLoading &&
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-honk-icon-accent-primary",
      )}
      onSubmit={props.onSubmit}
    >
      {showSegmentDisplay ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center truncate text-left text-honk-chrome outline-hidden"
          onClick={focusInput}
        >
          <span className="min-w-0 truncate">
            {segments.map((segment, index) => (
              <span
                key={`${segment.text}-${index}`}
                className={
                  segment.emphasis === "primary"
                    ? "text-honk-fg-primary"
                    : "text-honk-fg-quaternary"
                }
              >
                {segment.text}
              </span>
            ))}
          </span>
        </button>
      ) : null}

      <input
        ref={props.inputRef}
        aria-label="Browser location"
        className={cn(
          "min-w-0 flex-1 bg-transparent p-0 text-honk-chrome text-honk-fg-primary outline-hidden placeholder:text-honk-fg-quaternary",
          showSegmentDisplay && "sr-only",
        )}
        onBlur={() => setFocused(false)}
        onChange={(event) => props.onInputChange(event.currentTarget.value)}
        onFocus={() => setFocused(true)}
        placeholder={props.locationPlaceholder}
        spellCheck={false}
        value={props.inputValue}
      />
    </form>
  );
}
