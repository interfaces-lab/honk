import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";

type ComposerInlineChipTone = "default" | "object" | "danger";

interface ComposerInlineChipProps extends ComponentPropsWithoutRef<"span"> {
  tone?: ComposerInlineChipTone;
}

export function ComposerInlineChip(props: ComposerInlineChipProps) {
  const { className, tone = "default", ...spanProps } = props;

  return (
    <span
      {...spanProps}
      className={cn(
        "inline-flex max-w-full select-none items-center gap-1 rounded-sm border px-1.5 py-px font-multi text-body/[16px] font-medium align-middle",
        tone === "object"
          ? "border-(color:--multi-composer-object-border) bg-(color:--multi-composer-object-bg) text-(color:--multi-composer-object-fg)"
          : tone === "danger"
            ? "border-destructive/35 bg-destructive/8 text-destructive"
            : "border-multi-stroke-tertiary bg-multi-bg-quaternary text-multi-fg-primary",
        className,
      )}
    />
  );
}

export function ComposerInlineChipIcon(props: ComponentPropsWithoutRef<"span">) {
  const { className, ...spanProps } = props;

  return <span {...spanProps} className={cn("size-3.5 shrink-0 opacity-85", className)} />;
}

export function ComposerInlineChipLabel(props: { children: ReactNode }) {
  return <span className="truncate select-none text-body/[16px]">{props.children}</span>;
}
