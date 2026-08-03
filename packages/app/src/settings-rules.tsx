import type { OpenCodeClient } from "@honk/opencode";
import { normalizePathSeparators } from "@honk/shared/paths";
import { Badge, Text } from "@honk/ui";
import * as React from "react";

import { SettingsRow, SettingsRows, SettingsSection } from "./settings-controls";
import { SettingsInventoryStatus, SettingsNote, useSettingsInventory } from "./settings-inventory";

const AGENT_MODE_LABELS = {
  primary: "Primary",
  subagent: "Subagent",
  all: "All",
} as const;

// Config directories that only ever live under a user's home, never inside a checkout.
const PERSONAL_CONFIG_MARKERS = ["/.claude/", "/.agents/", "/.config/opencode/", "/.opencode/"];

function loadRules(client: OpenCodeClient) {
  return Promise.all([client.config.get(), client.skills.list(), client.agents.list()]).then(
    ([config, skills, agents]) => ({ config, skills, agents }) as const,
  );
}

export function SettingsRules(): React.ReactElement {
  const inventory = useSettingsInventory(loadRules);
  const data = inventory.state.phase === "ready" ? inventory.state.data : null;
  const instructions = data?.config.instructions ?? [];
  const skills = data?.skills.data ?? [];
  const subagents = (data?.agents.data ?? []).filter((agent) => !agent.hidden);

  return (
    <>
      <SettingsSection
        title="Rules"
        description="Instruction files the connected server loads into every session."
      >
        <SettingsInventoryStatus
          state={inventory.state}
          loading="Loading rules, skills and subagents…"
          unavailable="Connect to an OpenCode server to view rules, skills and subagents."
          onRetry={inventory.reload}
        />
        {instructions.length === 0 ? null : (
          <SettingsRows>
            {instructions.map((instruction) => (
              <SettingsRow
                key={instruction}
                title={instruction}
                control={
                  <Badge size="sm" tone="outline">
                    Config
                  </Badge>
                }
              />
            ))}
          </SettingsRows>
        )}
        {data === null ? null : (
          <SettingsNote>
            {instructions.length === 0
              ? "No extra instruction files are listed in the instructions section of opencode.json. "
              : ""}
            AGENTS.md and CLAUDE.md in the project root and ~/.claude/CLAUDE.md load automatically.
            AGENTS.md takes precedence over CLAUDE.md.
          </SettingsNote>
        )}
      </SettingsSection>

      <SettingsSection title="Skills" description="Skills the connected server can load on demand.">
        {data !== null && skills.length === 0 ? (
          <SettingsNote>
            No skills found. Add them under .claude/skills, .agents/skills, or the opencode config
            directory.
          </SettingsNote>
        ) : null}
        {skills.length === 0 ? null : (
          <SettingsRows>
            {skills.map((skill) => {
              const scope = skillScope(skill.location, data?.skills.location.directory);
              return (
                <SettingsRow
                  key={skill.location}
                  title={skill.name}
                  description={skill.description ?? skill.location}
                  control={
                    <>
                      {scope === null ? null : (
                        <Badge size="sm" tone="outline">
                          {scope}
                        </Badge>
                      )}
                      <Badge size="sm" tone="neutral">
                        {skillSource(skill.location)}
                      </Badge>
                    </>
                  }
                />
              );
            })}
          </SettingsRows>
        )}
      </SettingsSection>

      <SettingsSection
        title="Subagents"
        description="Agents this server can hand work to. Hidden agents are not listed."
      >
        {data !== null && subagents.length === 0 ? (
          <SettingsNote>No agents are configured on this server.</SettingsNote>
        ) : null}
        {subagents.length === 0 ? null : (
          <SettingsRows>
            {subagents.map((agent) => (
              <SettingsRow
                key={agent.id}
                title={agent.id}
                description={
                  <>
                    {agent.description ?? "No description."}
                    {agent.model === undefined ? null : (
                      <Text as="span" size="xs" tone="faint" family="mono">
                        {` · ${agent.model.providerID}/${agent.model.id}`}
                      </Text>
                    )}
                  </>
                }
                control={
                  <Badge size="sm" tone="neutral">
                    {AGENT_MODE_LABELS[agent.mode]}
                  </Badge>
                }
              />
            ))}
          </SettingsRows>
        )}
      </SettingsSection>
    </>
  );
}

function skillSource(location: string): string {
  if (location.includes("/.claude/")) return "Claude";
  if (location.includes("/.agents/")) return "Agents";
  if (location.includes("/.opencode/") || location.includes("/.config/opencode/"))
    return "OpenCode";
  return "Config";
}

// The list response reports the resolved project directory; anything under it is project scope.
// Outside it, only a known home config directory is reported — otherwise the scope stays unstated.
function skillScope(
  location: string,
  directory: string | undefined,
): "Project" | "Personal" | null {
  const path = normalizePathSeparators(location);
  const root = normalizePathSeparators(directory ?? "").replace(/\/+$/, "");
  if (root.length > 0 && path.startsWith(`${root}/`)) return "Project";
  return PERSONAL_CONFIG_MARKERS.some((marker) => path.includes(marker)) ? "Personal" : null;
}
