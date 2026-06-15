import { type ReactNode } from "react";

/**
 * Cursor parity: `composer-questionnaire-toolbar` (workbench.desktop.main.css).
 * One questionnaire surface for every pending-question panel: option rows with
 * letter chips (selected chip flips to the yellow accent), a quiet header, and
 * an opaque background so the question never blends into the timeline behind
 * the composer.
 */

export function questionnaireOptionLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function QuestionnaireSurface(props: { children: ReactNode }) {
  return (
    <div
      data-questionnaire-surface=""
      className="flex flex-col gap-3 rounded-[inherit] bg-(--honk-composer-surface-opaque-background) p-1.5 px-4 py-3 sm:px-5"
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
    <div className="relative ml-1 flex items-center gap-2 text-conversation">
      {props.icon ? <span className="mt-0.5 inline-block opacity-70">{props.icon}</span> : null}
      <span className="inline-block min-w-0 truncate text-honk-fg-primary">{props.title}</span>
      {props.trailing ? (
        <span className="ml-auto mr-0.5 inline-flex items-center gap-1 text-caption tabular-nums text-honk-fg-secondary">
          {props.trailing}
        </span>
      ) : null}
    </div>
  );
}

export function QuestionnaireQuestionLabel(props: {
  number?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="ml-1.5 flex items-start gap-2 text-conversation font-[590] leading-[135%] text-honk-fg-primary">
      {props.number ? (
        <span className="w-3 min-w-3 shrink-0 text-left text-honk-fg-secondary">
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
      className="-ml-1 mt-1 flex flex-col overflow-hidden"
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
          ? "inline-flex h-[19px] min-w-[19px] cursor-pointer items-center justify-center rounded-[3px] border border-(--honk-tone-yellow,var(--warning)) bg-(--honk-tone-yellow,var(--warning)) p-px font-sans text-[10px] font-bold leading-none text-(--honk-base-editor,var(--background))"
          : "inline-flex h-[19px] min-w-[19px] cursor-pointer items-center justify-center rounded-[3px] border border-honk-stroke-tertiary bg-transparent p-px font-sans text-[10px] font-bold leading-none text-honk-fg-secondary"
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
        "flex cursor-pointer items-start gap-2 overflow-hidden rounded-[4px] border border-transparent px-1 py-[3px] text-left",
        "hover:bg-honk-bg-tertiary",
        "focus-visible:bg-honk-bg-tertiary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--honk-stroke-focused)",
        props.disabled ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      <QuestionnaireOptionLetter selected={props.selected}>
        {props.letter}
      </QuestionnaireOptionLetter>
      <span className="min-w-0 flex-1">
        <span
          className={
            props.selected
              ? "text-conversation text-honk-fg-primary"
              : "text-conversation text-honk-fg-secondary"
          }
        >
          {props.label}
        </span>
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
    <div className="-ml-1 mt-1 flex items-start gap-2 rounded-[4px] border border-transparent px-1 py-[3px]">
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
        className="min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent p-0 text-conversation leading-[1.4] text-honk-fg-primary outline-none placeholder:text-honk-fg-quaternary"
      />
    </div>
  );
}

export function QuestionnaireActions(props: { children: ReactNode }) {
  return <div className="flex justify-end gap-2">{props.children}</div>;
}
