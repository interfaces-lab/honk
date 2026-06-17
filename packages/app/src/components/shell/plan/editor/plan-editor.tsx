"use client";

import { IconCheckmark1, IconCrossSmall } from "central-icons";

import { WorkbenchTextButton } from "@honk/honkkit/workbench-button";

import type { PlanEditorProps } from "./plan-editor-contract";
import { TipTapPlanEditor } from "./tiptap-editor";

export function PlanEditor(props: PlanEditorProps) {
  const canSave = props.dirty && !props.disabled;

  return (
    <div
      data-plan-editor=""
      className="composer-plan-markdown-container mb-4 flex min-w-0 flex-col"
    >
      <div className="plan-editor-toolbar mb-2 flex justify-end gap-(--honk-workbench-chrome-action-gap) px-1.5">
        <WorkbenchTextButton
          onClick={props.onCancel}
          disabled={props.disabled}
          title="Cancel editing"
        >
          <IconCrossSmall className="size-4 shrink-0" aria-hidden />
          <span>Cancel</span>
        </WorkbenchTextButton>
        <WorkbenchTextButton
          tone="primary"
          onClick={props.onSave}
          disabled={!canSave}
          title="Save plan"
        >
          <IconCheckmark1 className="size-4 shrink-0" aria-hidden />
          <span>Save</span>
        </WorkbenchTextButton>
      </div>
      <TipTapPlanEditor
        ariaLabel="Edit plan"
        disabled={props.disabled}
        onChange={props.onChange}
        value={props.value}
      />
    </div>
  );
}
