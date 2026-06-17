import { type ReactNode } from "react";

/**
 * Compact questionnaire surface for pending ask panels. The shell mirrors the
 * product editor card: quiet header, numbered option rows, and a small primary
 * action without letting the prompt blend into the timeline behind the composer.
 */

export function questionnaireOptionLetter(index: number): string {
  return String(index + 1);
}

export function questionnaireOptionIndexForKey(key: string): number | null {
  if (key.length !== 1) return null;
  if (key >= "1" && key <= "9") return Number(key) - 1;
  if (key === "0") return 9;

  const upperKey = key.toUpperCase();
  if (upperKey < "A" || upperKey > "Z") return null;
  return upperKey.charCodeAt(0) - 65;
}

export function QuestionnaireSurface(props: { children: ReactNode; embedded?: boolean }) {
  return (
    <div
      data-questionnaire-surface=""
      className={
        props.embedded
          ? "grid w-full bg-honk-bubble-opaque"
          : "grid w-full rounded-lg border border-honk-stroke-tertiary bg-honk-bubble-opaque"
      }
    >
      {props.children}
    </div>
  );
}

export function QuestionnaireHeader(props: {
  icon?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pt-1.5 pr-1.5 pb-0 pl-1">
      <div className="flex min-w-0 items-center gap-1.5 px-1 text-detail text-honk-fg-secondary">
        {props.icon ? <span className="shrink-0 opacity-70">{props.icon}</span> : null}
        <span className="min-w-0 truncate">{props.title}</span>
      </div>
      {props.trailing ? (
        <div className="ml-auto flex items-center gap-0.5">{props.trailing}</div>
      ) : null}
    </div>
  );
}

export function QuestionnaireQuestionLabel(props: {
  number?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-start gap-2 text-body font-medium text-honk-fg-primary">
      {props.number ? (
        <span className="w-4 shrink-0 text-left tabular-nums text-honk-fg-secondary">
          {props.number}
        </span>
      ) : null}
      <span className="min-w-0">{props.children}</span>
    </div>
  );
}

export function QuestionnaireOptions(props: {
  children: ReactNode;
  label: string;
  multiSelect?: boolean;
}) {
  return (
    <div
      role={props.multiSelect ? "group" : "radiogroup"}
      aria-label={props.label}
      className="space-y-0.5"
    >
      {props.children}
    </div>
  );
}

export function QuestionnaireOptionLetter(props: { selected: boolean; children: ReactNode }) {
  return (
    <span
      className={
        props.selected
          ? "flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded border border-honk-action bg-honk-action text-[0.6875rem] font-medium leading-none text-primary-foreground tabular-nums"
          : "flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded border border-honk-stroke-tertiary text-[0.6875rem] font-medium leading-none text-honk-fg-secondary tabular-nums"
      }
      aria-hidden="true"
    >
      {props.children}
    </span>
  );
}

export function QuestionnaireOptionButton(props: {
  letter: string;
  label: ReactNode;
  description?: ReactNode;
  selected: boolean;
  disabled: boolean;
  multiSelect?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      role={props.multiSelect ? "checkbox" : "radio"}
      aria-checked={props.selected}
      onClick={props.onSelect}
      className={[
        "flex w-full cursor-pointer items-center gap-2 rounded py-1 pr-1.5 pl-0 text-left text-honk-fg-secondary",
        "hover:bg-honk-bg-quaternary hover:text-honk-fg-primary",
        "focus-visible:bg-honk-bg-quaternary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-honk-stroke-focused",
        props.selected ? "bg-honk-bg-tertiary text-honk-fg-primary" : "",
        props.disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      <QuestionnaireOptionLetter selected={props.selected}>
        {props.letter}
      </QuestionnaireOptionLetter>
      <span className="min-w-0 flex-1 text-body">
        {props.label}
        {props.description ? (
          <span className="ml-2 text-caption text-honk-fg-tertiary">{props.description}</span>
        ) : null}
      </span>
    </button>
  );
}

export function QuestionnaireFreeformRow(props: {
  letter: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-0.5 flex items-start gap-2 rounded py-1 pr-1.5 pl-0 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary focus-within:bg-honk-bg-quaternary focus-within:text-honk-fg-primary">
      <QuestionnaireOptionLetter selected={props.value.trim().length > 0}>
        {props.letter}
      </QuestionnaireOptionLetter>
      <textarea
        rows={1}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoFocus={props.autoFocus ?? true}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || props.disabled) return;
          event.preventDefault();
          props.onSubmit();
        }}
        className="min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent p-0 text-body text-honk-fg-primary outline-none placeholder:text-honk-fg-quaternary"
      />
    </div>
  );
}

export function QuestionnaireActions(props: { children: ReactNode }) {
  return <div className="mt-1.5 flex items-center justify-end gap-2">{props.children}</div>;
}
