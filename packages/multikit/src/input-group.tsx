"use client";

import * as React from "react";

import { Button } from "./button";
import { Input, type InputControlSize } from "./input";
import { Textarea } from "./textarea";
import { cn } from "./utils";

type InputGroupContextValue = {
  disabled: boolean | undefined;
  size: InputControlSize;
};

const InputGroupContext = React.createContext<InputGroupContextValue>({
  disabled: undefined,
  size: "default",
});

function useInputGroupContext() {
  return React.useContext(InputGroupContext);
}

type InputGroupProps = React.ComponentProps<"div"> & {
  disabled?: boolean | undefined;
  size?: InputControlSize | undefined;
};

function InputGroup({
  children,
  className,
  disabled,
  size = "default",
  ...props
}: InputGroupProps) {
  return (
    <InputGroupContext.Provider value={{ disabled, size }}>
      <div
        className={cn(
          "relative inline-flex min-h-7 w-full min-w-0 items-center rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary text-honk-fg-primary shadow-none transition-colors duration-150 ease-out has-focus-visible:border-honk-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-honk-stroke-focused/30 has-aria-invalid:border-honk-stroke-red-primary has-disabled:opacity-64 motion-reduce:transition-none",
          size === "lg" && "min-h-8",
          className,
        )}
        data-disabled={disabled || undefined}
        data-size={size}
        data-slot="input-group"
        {...props}
      >
        {children}
      </div>
    </InputGroupContext.Provider>
  );
}

function InputGroupInput({
  className,
  disabled,
  size,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "nativeInput" | "unstyled">) {
  const context = useInputGroupContext();
  return (
    <Input
      className={className}
      disabled={disabled ?? context.disabled}
      nativeInput
      size={size ?? context.size}
      unstyled
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  disabled,
  size,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "unstyled">) {
  const context = useInputGroupContext();
  return (
    <Textarea
      className={className}
      disabled={disabled ?? context.disabled}
      size={size ?? context.size}
      unstyled
      {...props}
    />
  );
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-full shrink-0 items-center gap-1 px-2 text-body text-honk-fg-tertiary [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      data-slot="input-group-addon"
      {...props}
    />
  );
}

function InputGroupButton({
  size = "icon-xs",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof Button> & {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const context = useInputGroupContext();
  return (
    <Button
      disabled={props.disabled ?? context.disabled}
      size={size}
      variant={variant}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
  useInputGroupContext,
};
