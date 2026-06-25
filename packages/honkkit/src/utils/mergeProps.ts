import type * as React from "react";

type StyleObject = React.CSSProperties;
type PropsObject = {
  className?: string | undefined;
  style?: StyleObject | undefined;
  [key: string]: unknown;
};

function mergeTwoProps(base: PropsObject, overrides: PropsObject): PropsObject {
  const merged: PropsObject = { ...base, ...overrides };

  const className = [base.className, overrides.className].filter(Boolean).join(" ");
  if (className) {
    merged.className = className;
  } else {
    delete merged.className;
  }

  const style =
    overrides.style && base.style
      ? { ...base.style, ...overrides.style }
      : (overrides.style ?? base.style);
  if (style) {
    merged.style = style;
  } else {
    delete merged.style;
  }

  return merged;
}

function mergeProps(
  xdsClassOrStylexResult: string | PropsObject,
  stylexResultOrClassName?: PropsObject | string,
  classNameOrStyle?: string | React.CSSProperties,
  style?: React.CSSProperties,
): PropsObject {
  if (typeof xdsClassOrStylexResult === "string") {
    const xdsClass = xdsClassOrStylexResult;
    const stylexResult = (stylexResultOrClassName as PropsObject) ?? { className: "" };
    const className = classNameOrStyle as string | undefined;

    let mergedClassName = stylexResult.className
      ? `${xdsClass} ${stylexResult.className}`
      : xdsClass;
    if (className) {
      mergedClassName = `${mergedClassName} ${className}`;
    }

    const mergedStyle =
      style && stylexResult.style
        ? { ...stylexResult.style, ...style }
        : (style ?? stylexResult.style);

    return { ...stylexResult, className: mergedClassName, style: mergedStyle };
  }

  const first = xdsClassOrStylexResult;
  const second =
    typeof stylexResultOrClassName === "string"
      ? { className: stylexResultOrClassName }
      : (stylexResultOrClassName ?? {});
  let merged = mergeTwoProps(first, second);

  if (typeof classNameOrStyle === "string") {
    merged = mergeTwoProps(merged, { className: classNameOrStyle });
  } else if (classNameOrStyle != null) {
    merged = mergeTwoProps(merged, { style: classNameOrStyle });
  }

  if (style != null) {
    merged = mergeTwoProps(merged, { style });
  }

  return merged;
}

export { mergeProps };
export type { PropsObject };
