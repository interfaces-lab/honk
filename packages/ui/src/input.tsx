"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "./utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    "h-7 w-full min-w-0 rounded-[inherit] px-2 py-0 font-multi text-body outline-none placeholder:text-multi-fg-tertiary/72 [transition:background-color_5000000s_ease-in-out_0s]",
    size === "sm" && "h-7 px-2",
    size === "lg" && "h-8 px-2.5 sm:h-8",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            "relative inline-flex w-full rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-multi-fg-primary shadow-none transition-colors has-focus-visible:border-multi-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-multi-stroke-focused/30 has-focus-visible:has-aria-invalid:border-multi-stroke-red-primary has-focus-visible:has-aria-invalid:ring-multi-stroke-red-primary/20 has-aria-invalid:border-multi-stroke-red-primary has-disabled:opacity-64",
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          {...(props as React.ComponentPropsWithRef<"input">)}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          {...props}
        />
      )}
    </span>
  );
}

export { Input, type InputProps };
