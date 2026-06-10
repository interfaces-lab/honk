import { Button } from "@multi/multikit/button";
import { Input } from "@multi/multikit/input";
import { Text } from "@multi/multikit/text";
import { useThrottler } from "@tanstack/react-pacer";
import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";

import { DEFAULT_APPEARANCE_TINT_HUE } from "../../../lib/appearance-colors";
import { appearanceSettingsActions } from "../../../stores/appearance-store";
import { SettingsRow } from "../settings-layout";

function SettingsSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  variant?: "hue" | "intensity";
  tintHue?: number;
  tintSaturation?: number;
  showSwatch?: boolean;
  suffix?: string;
}) {
  const tintIntensity = props.tintSaturation ?? 0;
  const thumbHue = props.tintHue ?? DEFAULT_APPEARANCE_TINT_HUE;
  const thumbSaturation = props.variant === "hue" && tintIntensity <= 0 ? 0 : tintIntensity;
  const swatchColor = `hsl(${thumbHue} ${thumbSaturation}% 50%)`;
  const sliderClassName =
    props.variant === "hue"
      ? "multi-appearance-hue-slider"
      : props.variant === "intensity"
        ? "multi-appearance-intensity-slider"
        : undefined;
  const sliderStyle = props.variant
    ? ({
        "--multi-appearance-slider-hue": String(thumbHue),
        "--multi-appearance-slider-sat": `${thumbSaturation}%`,
        "--multi-appearance-slider-light": "50%",
      } as CSSProperties)
    : { accentColor: "var(--multi-action)" };

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2 sm:w-34">
      <input
        aria-label={props.label}
        className={sliderClassName ? `${sliderClassName} w-full` : "h-4 w-full"}
        max={props.max}
        min={props.min}
        style={sliderStyle}
        type="range"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <span className="flex w-10 shrink-0 justify-end">
        {props.showSwatch ? (
          <span
            aria-hidden
            className="size-5 rounded-full shadow-multi-swatch-inset"
            style={{ backgroundColor: swatchColor }}
          />
        ) : (
          <Text size="xs" tone="tertiary" className="w-full text-right tabular-nums">
            {props.value}
            {props.suffix ?? ""}
          </Text>
        )}
      </span>
    </div>
  );
}

const NUMBER_STEPPER_BUTTON_CLASS =
  "h-7 min-h-7 w-7 shrink-0 rounded-none border-transparent px-0 text-multi-fg-tertiary shadow-none outline-none ring-offset-0 before:hidden hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-0 data-pressed:bg-multi-bg-quaternary active:bg-multi-bg-quaternary";

export function NumberStepper(props: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => {
    if (!Number.isFinite(next)) return;
    const boundedMin = Math.max(props.min, Math.round(next));
    props.onChange(props.max === undefined ? boundedMin : Math.min(props.max, boundedMin));
  };

  return (
    <div className="inline-flex h-7 min-h-7 items-stretch overflow-hidden rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-body shadow-none">
      <Button
        type="button"
        variant="ghost"
        className={NUMBER_STEPPER_BUTTON_CLASS}
        aria-label={`Decrease ${props.label}`}
        onClick={() => set(props.value - 1)}
      >
        -
      </Button>
      <input
        aria-label={props.label}
        className="-mx-px h-full min-h-7 w-14 shrink-0 border-x border-multi-stroke-tertiary bg-transparent px-0 py-0 text-center leading-7 tabular-nums outline-none [appearance:textfield] focus-visible:relative focus-visible:z-[1] focus-visible:border-multi-stroke-focused [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
        max={props.max}
        min={props.min}
        inputMode="numeric"
        type="number"
        value={props.value}
        onChange={(event) => set(Number(event.target.value))}
      />
      <Button
        type="button"
        variant="ghost"
        className={NUMBER_STEPPER_BUTTON_CLASS}
        aria-label={`Increase ${props.label}`}
        onClick={() => set(props.value + 1)}
      >
        +
      </Button>
    </div>
  );
}

const APPEARANCE_TINT_COMMIT_WAIT_MS = 32;

export function AppearanceTintSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  variant: "hue" | "intensity";
  tintHue: number;
  tintSaturation: number;
  showSwatch?: boolean;
  suffix?: string;
}) {
  const commitValue = useThrottler(props.onChange, {
    wait: APPEARANCE_TINT_COMMIT_WAIT_MS,
    onUnmount: (throttler) => throttler.flush(),
  });

  return (
    <SettingsSlider
      label={props.label}
      max={props.max}
      min={props.min}
      tintHue={props.tintHue}
      tintSaturation={props.tintSaturation}
      value={props.value}
      variant={props.variant}
      {...(props.showSwatch === undefined ? {} : { showSwatch: props.showSwatch })}
      {...(props.suffix === undefined ? {} : { suffix: props.suffix })}
      onChange={(value) => commitValue.maybeExecute(value)}
    />
  );
}

export function FontFamilyInput(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onDraftValueChange?: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState("");
  const [focused, setFocused] = useState(false);
  const draftValueRef = useRef("");
  const displayedValue = focused ? draftValue : props.value;

  const updateDraftValue = (nextValue: string) => {
    draftValueRef.current = nextValue;
    setDraftValue(nextValue);
    props.onDraftValueChange?.(nextValue);
  };

  const commitDraftValue = () => {
    const nextValue = draftValueRef.current;
    if (nextValue !== props.value) {
      props.onChange(nextValue);
    }
  };

  return (
    <Input
      nativeInput
      size="sm"
      className="w-full border-multi-stroke-tertiary bg-multi-bg-quinary shadow-none has-focus-visible:border-multi-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-multi-stroke-focused sm:w-36"
      value={displayedValue}
      placeholder={props.placeholder}
      aria-label={props.label}
      onFocus={() => {
        setFocused(true);
        updateDraftValue(props.value);
      }}
      onBlur={() => {
        setFocused(false);
        commitDraftValue();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onChange={(event) => {
        updateDraftValue(event.target.value);
      }}
    />
  );
}

type CodePreviewTokenColor = "keyword" | "variable" | "punctuation";

interface CodePreviewToken {
  text: string;
  color?: CodePreviewTokenColor;
}

interface CodePreviewLine {
  kind: "deletion" | "addition";
  number: number;
  tokens: CodePreviewToken[];
}

/* Pre-tokenized stand-in for the real diff renderer, so the settings page
   stays free of the shiki/web-component machinery. */
const CODE_FONT_PREVIEW_LINES: CodePreviewLine[] = [
  {
    kind: "deletion",
    number: 1,
    tokens: [
      { text: "return", color: "keyword" },
      { text: " " },
      { text: "a", color: "variable" },
      { text: " + ", color: "punctuation" },
      { text: "b", color: "variable" },
      { text: ";", color: "punctuation" },
    ],
  },
  {
    kind: "addition",
    number: 1,
    tokens: [
      { text: "const", color: "keyword" },
      { text: " " },
      { text: "result", color: "variable" },
      { text: " = ", color: "punctuation" },
      { text: "a", color: "variable" },
      { text: " + ", color: "punctuation" },
      { text: "b", color: "variable" },
      { text: ";", color: "punctuation" },
    ],
  },
  {
    kind: "addition",
    number: 2,
    tokens: [
      { text: "return", color: "keyword" },
      { text: " " },
      { text: "result", color: "variable" },
      { text: ";", color: "punctuation" },
    ],
  },
];

const CODE_PREVIEW_TOKEN_CLASS: Record<CodePreviewTokenColor, string> = {
  keyword: "text-[var(--multi-git-diff-syntax-keyword)]",
  variable: "text-[var(--multi-git-diff-syntax-variable)]",
  punctuation: "text-[var(--multi-git-diff-syntax-punctuation)]",
};

const CODE_PREVIEW_LINE_CLASS = {
  deletion: "bg-[var(--multi-git-diff-deletion-line-background)]",
  addition: "bg-[var(--multi-git-diff-addition-line-background)]",
} as const;

const CODE_PREVIEW_LINE_NUMBER_CLASS = {
  deletion: "text-[var(--multi-git-diff-deletion-line-number)]",
  addition: "text-[var(--multi-git-diff-addition-line-number)]",
} as const;

export function CodeFontFamilySettingsRow(props: { codeFont: string }) {
  const [codeFontDraft, setCodeFontDraft] = useState(() => props.codeFont);
  const codePreviewStyle: CSSProperties = {
    fontFamily: codeFontDraft.trim() || "var(--multi-font-mono)",
    fontSize: "var(--multi-code-font-size-user, 12px)",
    lineHeight: "calc(var(--multi-code-font-size-user, 12px) * 1.45)",
  };

  return (
    <SettingsRow
      title="Code Font Family"
      description="Editor font."
      control={
        <FontFamilyInput
          label="Code Font Family"
          value={props.codeFont}
          placeholder="System monospace"
          onChange={appearanceSettingsActions.setCodeFontFamily}
          onDraftValueChange={setCodeFontDraft}
        />
      }
    >
      <div className="mt-2 overflow-hidden rounded-sm" style={codePreviewStyle}>
        {CODE_FONT_PREVIEW_LINES.map((line, index) => (
          <div
            key={index}
            className={`flex text-foreground/72 ${CODE_PREVIEW_LINE_CLASS[line.kind]}`}
          >
            <span
              className={`w-8 shrink-0 text-center ${CODE_PREVIEW_LINE_NUMBER_CLASS[line.kind]}`}
            >
              {line.number}
            </span>
            <span>
              {line.tokens.map((token, tokenIndex) =>
                token.color ? (
                  <span key={tokenIndex} className={CODE_PREVIEW_TOKEN_CLASS[token.color]}>
                    {token.text}
                  </span>
                ) : (
                  token.text
                ),
              )}
            </span>
          </div>
        ))}
      </div>
    </SettingsRow>
  );
}
