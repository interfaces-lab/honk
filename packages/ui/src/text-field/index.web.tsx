import * as React from "react";
import * as stylex from "@stylexjs/stylex";

import {
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
} from "../platform-tokens.stylex";
import type { TextFieldHandle, TextFieldProps } from "./types";

const FIELD_RING = `inset 0 0 0 ${controlVars["--honk-control-border-width"]} ${colorVars["--honk-color-border-base"]}`;

const sx = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  labelInvalid: {
    color: colorVars["--honk-color-err-fg"],
  },
  required: {
    color: colorVars["--honk-color-err-fg"],
  },
  surface: {
    alignItems: "center",
    backgroundColor: colorVars["--honk-color-layer-01"],
    borderRadius: radiusVars["--honk-radius-field"],
    boxShadow: FIELD_RING,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    gap: controlVars["--honk-control-gap"],
    outlineColor: colorVars["--honk-color-accent"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    width: "100%",
  },
  surfaceInvalid: {
    backgroundColor: colorVars["--honk-color-err-bg"],
    boxShadow: `inset 0 0 0 ${controlVars["--honk-control-border-width"]} ${colorVars["--honk-color-err-border"]}`,
    outlineColor: colorVars["--honk-color-err-fg"],
  },
  sizeMd: {
    minHeight: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
  },
  sizeLg: {
    minHeight: controlVars["--honk-control-h-lg"],
    paddingInline: controlVars["--honk-control-pad-lg"],
  },
  surfaceMultiline: {
    alignItems: "stretch",
    minHeight: controlVars["--honk-control-field-multiline-min-h"],
  },
  input: {
    backgroundColor: "transparent",
    borderStyle: "none",
    borderWidth: 0,
    color: colorVars["--honk-color-text-primary"],
    flexBasis: "0%",
    flexGrow: 1,
    flexShrink: 1,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    minWidth: 0,
    outline: "none",
    padding: 0,
    resize: "none",
    "::placeholder": {
      color: colorVars["--honk-color-text-faint"],
    },
  },
  accessory: {
    alignItems: "center",
    display: "flex",
    flexShrink: 0,
  },
  error: {
    color: colorVars["--honk-color-err-fg"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-caption"],
  },
});

type WebFieldElement = HTMLInputElement | HTMLTextAreaElement;

const TextField = React.forwardRef<TextFieldHandle, TextFieldProps>(function TextField(
  {
    accessibilityHint,
    autoCapitalize,
    autoComplete,
    autoCorrect,
    autoFocus,
    defaultValue,
    disabled = false,
    error,
    inputMode,
    label,
    leading,
    maxLength,
    minRows = 3,
    multiline = false,
    onChangeText,
    onFocusChange,
    onSubmit,
    placeholder,
    readOnly = false,
    required = false,
    returnKeyType,
    secureTextEntry,
    selection,
    size = "md",
    submitBehavior,
    testID,
    trailing,
    value,
  },
  forwardedRef,
): React.ReactElement {
  const generatedId = React.useId();
  const inputId = testID ?? generatedId;
  const errorId = `${inputId}-error`;
  const inputRef = React.useRef<WebFieldElement>(null);
  const currentValue = React.useRef(value ?? defaultValue ?? "");
  const invalid = error !== undefined;
  const effectiveSubmitBehavior = submitBehavior ?? (multiline ? "newline" : "blurAndSubmit");

  const setInputRef = React.useCallback(
    (node: WebFieldElement | null): void => {
      inputRef.current = node;
      if (node !== null && selection !== undefined) {
        node.setSelectionRange(selection.start, selection.end ?? selection.start);
      }
    },
    [selection],
  );

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      clear: () => {
        if (inputRef.current !== null) inputRef.current.value = "";
        currentValue.current = "";
        onChangeText?.("");
      },
      isFocused: () => inputRef.current === document.activeElement,
      getValue: () => value ?? currentValue.current,
    }),
    [onChangeText, value],
  );

  const sharedProps = {
    "aria-describedby": error === undefined ? undefined : errorId,
    "aria-description": accessibilityHint,
    "aria-invalid": invalid,
    "aria-label": required ? `${label}, required` : label,
    autoCapitalize,
    autoComplete,
    autoCorrect: autoCorrect === undefined ? undefined : autoCorrect ? "on" : "off",
    autoFocus,
    disabled,
    enterKeyHint: returnKeyType,
    id: inputId,
    inputMode,
    maxLength,
    onBlur: () => onFocusChange?.(false),
    onChange: (event: React.ChangeEvent<WebFieldElement>) => {
      currentValue.current = event.target.value;
      onChangeText?.(event.target.value);
    },
    onFocus: () => onFocusChange?.(true),
    onKeyDown: (event: React.KeyboardEvent<WebFieldElement>) => {
      if (event.key !== "Enter" || effectiveSubmitBehavior === "newline") return;
      event.preventDefault();
      onSubmit?.(value ?? currentValue.current);
      if (effectiveSubmitBehavior === "blurAndSubmit") event.currentTarget.blur();
    },
    placeholder,
    readOnly,
    required,
  } as const;
  const valueProps = value === undefined ? { defaultValue } : { value };
  const inputStyles = stylex.props(sx.input);

  return (
    <div {...stylex.props(sx.root, disabled && sx.disabled)} data-testid={testID}>
      <label htmlFor={inputId} {...stylex.props(sx.label, invalid && sx.labelInvalid)}>
        {label}
        {required ? <span {...stylex.props(sx.required)}> *</span> : null}
      </label>
      <div
        role="presentation"
        onMouseDown={(event) => {
          const target = event.target;
          if (
            event.target === inputRef.current ||
            disabled ||
            (target instanceof Element &&
              target.closest("button, a, input, textarea, select, [role='button']") !== null)
          ) {
            return;
          }
          event.preventDefault();
          inputRef.current?.focus();
        }}
        {...stylex.props(
          sx.surface,
          size === "lg" ? sx.sizeLg : sx.sizeMd,
          multiline && sx.surfaceMultiline,
          invalid && sx.surfaceInvalid,
        )}
      >
        {leading === undefined ? null : <span {...stylex.props(sx.accessory)}>{leading}</span>}
        {multiline ? (
          <textarea
            {...sharedProps}
            {...valueProps}
            {...inputStyles}
            ref={setInputRef}
            rows={minRows}
          />
        ) : (
          <input
            {...sharedProps}
            {...valueProps}
            {...inputStyles}
            ref={setInputRef}
            type={secureTextEntry ? "password" : "text"}
          />
        )}
        {trailing === undefined ? null : <span {...stylex.props(sx.accessory)}>{trailing}</span>}
      </div>
      {error === undefined ? null : (
        <span id={errorId} role="alert" {...stylex.props(sx.error)}>
          {error}
        </span>
      )}
    </div>
  );
});

export { TextField };
export type {
  TextFieldAutoComplete,
  TextFieldHandle,
  TextFieldInputMode,
  TextFieldProps,
  TextFieldReturnKey,
  TextFieldSelection,
  TextFieldSize,
  TextFieldSubmitBehavior,
} from "./types";
