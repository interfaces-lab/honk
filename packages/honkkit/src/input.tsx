"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "./utils";

export type InputControlSize = "sm" | "default" | "lg" | number;

export const InputControlSizeContext = React.createContext<InputControlSize>("default");

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: InputControlSize;
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  ref,
  ...props
}: InputProps) {
  const inputClassName = cn(
    "h-6 w-full min-w-0 rounded-[inherit] px-2 py-0 font-honk text-honk-chrome outline-none placeholder:text-honk-fg-tertiary/72 [transition:background-color_5000000s_ease-in-out_0s]",
    size === "sm" && "h-6 px-2",
    size === "lg" && "h-7 px-2.5",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );
  const htmlSizeProps = typeof size === "number" ? { size } : {};

  if (nativeInput) {
    const htmlProps = props as React.ComponentProps<"input">;
    return (
      <span
        className={
          cn(
            !unstyled &&
              "relative inline-flex w-full rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-fg-primary shadow-none transition-colors has-focus-visible:border-honk-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-honk-stroke-focused/30 has-focus-visible:has-aria-invalid:border-honk-stroke-red-primary has-focus-visible:has-aria-invalid:ring-honk-stroke-red-primary/20 has-aria-invalid:border-honk-stroke-red-primary has-disabled:opacity-64",
            className,
          ) || undefined
        }
        data-size={size}
        data-slot="input-control"
      >
        <input
          className={inputClassName}
          data-slot="input"
          ref={ref}
          {...htmlSizeProps}
          {...htmlProps}
        />
      </span>
    );
  }

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-fg-primary shadow-none transition-colors has-focus-visible:border-honk-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-honk-stroke-focused/30 has-focus-visible:has-aria-invalid:border-honk-stroke-red-primary has-focus-visible:has-aria-invalid:ring-honk-stroke-red-primary/20 has-aria-invalid:border-honk-stroke-red-primary has-disabled:opacity-64",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        ref={ref}
        {...htmlSizeProps}
        {...props}
      />
    </span>
  );
}

export type NativeInputRenderProps = Omit<React.ComponentPropsWithRef<"input">, "size"> & {
  className?: string | undefined;
};

export function NativeInputRender({ className, ...props }: NativeInputRenderProps) {
  const size = React.useContext(InputControlSizeContext);
  return <Input nativeInput size={size} className={className} {...props} />;
}

export { Input, type InputProps };
