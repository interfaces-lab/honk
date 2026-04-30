import type { HarnessDescriptor, HarnessKind } from "~/lib/ui-session-types";
import { IconCheckmark1Small } from "central-icons";
import { useMemo, useState } from "react";

import { useHarnessList } from "./harness-store";

export interface DefaultHarnessState {
  kind: HarnessKind;
  descriptor: HarnessDescriptor | null;
  loading: boolean;
}

export function useDefaultHarness(): DefaultHarnessState {
  const { descriptors, defaultKind, loading } = useHarnessList();
  return useMemo(
    () => ({
      kind: defaultKind,
      descriptor: descriptors.find((item) => item.kind === defaultKind) ?? null,
      loading,
    }),
    [defaultKind, descriptors, loading],
  );
}

export function HarnessPicker(props: {
  value: HarnessKind;
  onChange: (kind: HarnessKind) => void;
  disabled?: boolean;
}) {
  const { descriptors } = useHarnessList();
  const [open, setOpen] = useState(false);
  const items = descriptors.filter((item) => item.available && item.enabled);
  const selected = items.find((item) => item.kind === props.value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        className="flex items-center gap-2 rounded-multi-card border border-multi-border/40 bg-multi-bubble/60 px-2.5 py-1.5 text-detail font-medium text-foreground/85 transition-colors hover:bg-multi-hover disabled:opacity-40"
      >
        <span className="size-2 rounded-full bg-emerald-500" />
        <span>{selected?.label ?? props.value}</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] rounded-multi-card border border-multi-border/60 bg-multi-bubble p-1 shadow-multi-card">
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => {
                props.onChange(item.kind);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-detail hover:bg-multi-hover"
            >
              <span className="size-2 rounded-full bg-emerald-500" />
              <span className="flex-1">{item.label}</span>
              {props.value === item.kind ? (
                <IconCheckmark1Small className="size-4 text-foreground/70" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
