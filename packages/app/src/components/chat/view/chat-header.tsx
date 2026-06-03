import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
} from "@multi/contracts";
import { IconSidebar } from "central-icons";
import { Button } from "@multi/ui/button";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../../project-scripts-control";
import { shellPanelsActions } from "~/stores/shell-panels-store";

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
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
}

export function ChatHeader({
  activeThreadTitle,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions pointer-events-auto flex min-w-0 flex-1 select-none items-center gap-2 text-body">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-(--multi-titlebar-control-height) min-w-(--multi-titlebar-control-height) shrink-0 rounded-multi-control p-0 shadow-none before:hidden md:hidden"
          aria-label="Toggle sidebar"
          onClick={() => shellPanelsActions.toggleLeft()}
        >
          <IconSidebar className="size-4 shrink-0" />
        </Button>
        <div className="no-drag flex min-w-0 shrink items-center">
          <button
            type="button"
            aria-label={`Chat title. Right-click for more actions. ${activeThreadTitle}`}
            className="flex min-w-0 shrink items-center rounded-sm px-1 py-0.5 text-left text-body font-medium text-multi-fg-primary hover:bg-multi-bg-quaternary"
            title={activeThreadTitle}
          >
            <span className="min-w-0 truncate">{activeThreadTitle}</span>
          </button>
        </div>
      </div>
      <div
        className="drag-region pointer-events-auto min-h-(--multi-titlebar-control-height) min-w-8 flex-1 self-center"
        aria-hidden
      />
      {activeProjectScripts ? (
        <div className="no-drag flex shrink-0 items-center">
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        </div>
      ) : null}
    </div>
  );
}
