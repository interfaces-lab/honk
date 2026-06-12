import { type ChangeEvent, type KeyboardEvent, useRef, useState } from "react";

import { Input, type InputProps } from "@honk/multikit/input";

export type DraftInputProps = Omit<InputProps, "value" | "onChange" | "defaultValue"> & {
  readonly value: string;
  readonly onCommit: (next: string) => void;
};

function useCommitOnBlur(value: string, onCommit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const displayedValue = focusedRef.current ? draft : value;

  return {
    value: displayedValue,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
    },
    onFocus: () => {
      focusedRef.current = true;
      setDraft(value);
    },
    onBlur: () => {
      focusedRef.current = false;
      if (draft !== value) {
        onCommit(draft);
      }
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      }
    },
  };
}

export function DraftInput({ value, onCommit, ...rest }: DraftInputProps) {
  const bag = useCommitOnBlur(value, onCommit);
  return <Input {...rest} {...bag} />;
}
