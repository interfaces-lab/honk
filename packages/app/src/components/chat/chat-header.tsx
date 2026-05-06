import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
} from "@multi/contracts";
import { memo } from "react";
import { IconSidebar } from "central-icons";
import { Button } from "@multi/ui/button";
import type { NewProjectScriptInput } from "../project-scripts-control";
import { shellPanelsActions } from "~/lib/shell-panels-store";

interface ChatHeaderProps {
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({ activeThreadTitle }: ChatHeaderProps) {
  return (
    <div className="no-drag @container/header-actions flex min-w-0 flex-1 select-none items-center gap-2 text-[12px]/[16px]">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 md:hidden"
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-3.5" />
        </Button>
        <button
          type="button"
          aria-label={`Chat title. Right-click for more actions. ${activeThreadTitle}`}
          className="no-drag flex min-w-0 shrink items-center rounded-[4px] px-1 py-0.5 text-left text-[12px]/[16px] font-medium text-multi-fg-primary hover:bg-multi-bg-quaternary"
          title={activeThreadTitle}
        >
          <span className="min-w-0 truncate">{activeThreadTitle}</span>
        </button>
      </div>
    </div>
  );
});
