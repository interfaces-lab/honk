import {
  IconChevronRightMedium,
  IconFolderAddRight,
  IconFolderOpen,
  IconSettingsGear2,
} from "central-icons";
import type { ReactNode } from "react";

function HeroActionCard(props: {
  title: string;
  detail: string;
  icon: ReactNode;
  iconClassName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group flex h-20 min-h-20 select-none flex-col justify-between rounded-lg border border-multi-stroke-tertiary bg-multi-bg-elevated p-3 text-left text-multi-fg-primary shadow-none transition-colors hover:border-multi-stroke-secondary hover:bg-multi-bg-quaternary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:outline-none"
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-tertiary ${props.iconClassName}`}
        >
          {props.icon}
        </span>
        <IconChevronRightMedium className="size-4 shrink-0 text-multi-fg-tertiary transition-colors group-hover:text-multi-fg-primary" />
      </span>
      <span className="grid gap-0.5">
        <span className="truncate text-body font-medium">{props.title}</span>
        <span className="truncate text-detail text-multi-fg-secondary">{props.detail}</span>
      </span>
    </button>
  );
}

export function HeroActions(props: {
  activeProjectName: string | null;
  onAddProject: () => void;
  onOpenAppearance: () => void;
  onOpenProjects: () => void;
}) {
  return (
    <div className="mt-3 grid w-full select-none gap-2.5 sm:grid-cols-3">
      <HeroActionCard
        title="Projects"
        detail={props.activeProjectName ?? "Browse projects"}
        icon={<IconFolderOpen className="size-3.5" />}
        iconClassName="text-multi-action"
        onClick={props.onOpenProjects}
      />
      <HeroActionCard
        title="Add project"
        detail="Choose a folder"
        icon={<IconFolderAddRight className="size-3.5" />}
        iconClassName="text-success"
        onClick={props.onAddProject}
      />
      <HeroActionCard
        title="Appearance"
        detail="Theme and accent"
        icon={<IconSettingsGear2 className="size-3.5" />}
        iconClassName="text-primary"
        onClick={props.onOpenAppearance}
      />
    </div>
  );
}
