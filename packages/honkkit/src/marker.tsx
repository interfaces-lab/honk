"use client";

import { IconExclamationCircle } from "central-icons";
import { type ComponentProps, type ReactNode } from "react";

import { cn } from "./utils";

function Marker({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 items-start gap-1.5 text-[13px] leading-[22px]", className)}
      data-slot="marker"
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "mx-1 mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center",
        className,
      )}
      data-slot="marker-icon"
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("min-w-0 flex-1 select-text", className)}
      data-slot="marker-content"
      {...props}
    />
  );
}

function MarkerAction({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("shrink-0", className)} data-slot="marker-action" {...props} />;
}

const statusNoticeToneClasses = {
  error: "text-destructive [&>svg]:text-destructive",
  warning: "text-warning [&>svg]:text-warning",
} as const;

function StatusNotice({
  action,
  className,
  message,
  tone = "error",
}: {
  action?: ReactNode;
  className?: string | undefined;
  message: string;
  tone?: keyof typeof statusNoticeToneClasses | undefined;
}) {
  return (
    <Marker
      className={cn(statusNoticeToneClasses[tone], className)}
      role={tone === "error" ? "alert" : "status"}
    >
      <MarkerIcon>
        <IconExclamationCircle className="size-full" aria-hidden="true" />
      </MarkerIcon>
      <MarkerContent className="line-clamp-3" title={message}>
        {message}
      </MarkerContent>
      {action ? <MarkerAction>{action}</MarkerAction> : null}
    </Marker>
  );
}

export { Marker, MarkerAction, MarkerContent, MarkerIcon, StatusNotice };
