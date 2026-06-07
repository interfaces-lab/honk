"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn, controlTransitionClassName } from "./utils";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-multi-bg-tertiary font-multi text-detail font-medium text-multi-fg-secondary",
        className,
      )}
      data-slot="avatar"
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      className={cn(
        "size-full object-cover transition-opacity duration-150 ease-out data-starting-style:opacity-0 motion-reduce:transition-none",
        className,
      )}
      data-slot="avatar-image"
      {...props}
    />
  );
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center rounded-[inherit]",
        controlTransitionClassName,
        className,
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
