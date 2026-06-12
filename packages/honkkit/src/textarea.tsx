"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import { mergeProps } from "@base-ui/react/merge-props";
import * as React from "react";

import { cn } from "./utils";

type TextareaControlProps = React.ComponentProps<"textarea"> & {
  size?: "sm" | "default" | "lg" | number;
};

const TextareaControlPropsContext = React.createContext<Omit<TextareaControlProps, "size"> | null>(
  null,
);
const TextareaControlSizeContext = React.createContext<TextareaControlProps["size"]>("default");

function TextareaControl({ className, size = "default", ...props }: TextareaControlProps) {
  return (
    <textarea
      className={cn(
        "field-sizing-content min-h-17.5 w-full rounded-[inherit] px-1.5 py-1 font-honk text-body outline-none max-sm:min-h-20.5",
        size === "sm" && "min-h-16.5 px-1.5 py-1 max-sm:min-h-19.5",
        size === "lg" && "min-h-18.5 py-1.5 max-sm:min-h-21.5",
        className,
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

function textareaControlSizeProps(
  size: TextareaControlProps["size"],
): Pick<TextareaControlProps, "size"> {
  return size === undefined ? {} : { size };
}

function TextareaFieldControlRender(defaultProps: React.ComponentProps<"textarea">) {
  const controlProps = React.useContext(TextareaControlPropsContext);
  const size = React.useContext(TextareaControlSizeContext);
  if (!controlProps) {
    return <TextareaControl {...defaultProps} {...textareaControlSizeProps(size)} />;
  }
  return (
    <TextareaControl
      {...mergeProps(defaultProps, controlProps)}
      {...textareaControlSizeProps(size)}
    />
  );
}

type TextareaProps = React.ComponentProps<"textarea"> & {
  controlClassName?: string;
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
};

function Textarea({
  className,
  controlClassName,
  size = "default",
  unstyled = false,
  ...props
}: TextareaProps) {
  return (
    <span
      className={
        cn(
          !unstyled &&
            "t-input relative inline-flex w-full rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-fg-primary shadow-none transition-colors has-focus-visible:border-honk-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-honk-stroke-focused/30 has-focus-visible:has-aria-invalid:border-honk-stroke-red-primary has-focus-visible:has-aria-invalid:ring-honk-stroke-red-primary/20 has-aria-invalid:border-honk-stroke-red-primary has-disabled:opacity-64 motion-reduce:transition-none",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="textarea-control"
    >
      <TextareaControlPropsContext.Provider value={{ ...props, className: controlClassName }}>
        <TextareaControlSizeContext.Provider value={size}>
          <FieldPrimitive.Control render={TextareaFieldControlRender} />
        </TextareaControlSizeContext.Provider>
      </TextareaControlPropsContext.Provider>
    </span>
  );
}

export { Textarea, type TextareaProps };
