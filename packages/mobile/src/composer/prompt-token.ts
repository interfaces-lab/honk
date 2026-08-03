// Mirrors the trigger and ranking rules in packages/app/src/composer/prompt-editor.tsx so "/" and
// "@" resolve to the same items in the same order on both clients. The mobile composer is a plain
// TextInput, so a completion lands as plain text instead of a Lexical mention node.

export type PromptTokenKind = "command" | "file";

export interface PromptToken {
  readonly kind: PromptTokenKind;
  readonly query: string;
  // `start` is the trigger character itself, so replacing [start, end) also removes the "/" or "@".
  readonly start: number;
  readonly end: number;
}

export interface PromptMenuItem {
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  readonly section: string;
  // Full replacement text for [token.start, token.end), including the trigger character.
  readonly insert: string;
}

export interface PromptSkillSource {
  readonly name: string;
  readonly description?: string;
  readonly slash?: boolean;
}

export interface PromptCommandSource {
  readonly name: string;
  readonly description?: string;
}

export interface PromptCommandEntry {
  readonly name: string;
  readonly description: string;
  readonly isSkill: boolean;
}

export interface PromptFileSource {
  readonly path: string;
  readonly type: "file" | "directory";
}

export const PROMPT_MENU_MAX_ITEMS = 32;
export const PROMPT_FILE_SEARCH_DEBOUNCE_MS = 120;

// An empty "/" query is a browse, not a search: keep each section short enough to scan.
const PROMPT_MENU_BROWSE_PER_SECTION = 3;

// "/" stops at word characters because only a leading /token submits as a command; "@" takes any
// non-space so "@src/foo.ts" keeps matching. A typed space or a second "@" fails both and closes
// the menu without a special case.
const COMMAND_TRIGGER = /(^|\s)\/([\w:.-]*)$/;
const FILE_TRIGGER = /(^|\s)@([^\s@]*)$/;

// Call only for a collapsed selection. A range selection has no single insertion point, so there is
// no honest token to complete.
export function detectPromptToken(text: string, cursor: number): PromptToken | null {
  if (cursor < 0 || cursor > text.length) {
    return null;
  }
  const before = text.slice(0, cursor);
  const command = COMMAND_TRIGGER.exec(before);
  if (command !== null) {
    const query = command[2] ?? "";
    return { kind: "command", query, start: cursor - query.length - 1, end: cursor };
  }
  const file = FILE_TRIGGER.exec(before);
  if (file === null) {
    return null;
  }
  const query = file[2] ?? "";
  return { kind: "file", query, start: cursor - query.length - 1, end: cursor };
}

export function applyPromptSuggestion(
  text: string,
  token: PromptToken,
  insert: string,
): { readonly text: string; readonly cursor: number } {
  const after = text.slice(token.end);
  // A completion always ends the token, but do not stack a second space on one already there.
  const separator = after.startsWith(" ") ? "" : " ";
  return {
    text: `${text.slice(0, token.start)}${insert}${separator}${after}`,
    cursor: token.start + insert.length + 1,
  };
}

// Skills come first and win a name collision, matching the desktop merge order.
export function mergePromptCommands(input: {
  readonly skills: readonly PromptSkillSource[];
  readonly commands: readonly PromptCommandSource[];
}): readonly PromptCommandEntry[] {
  const skills = input.skills
    .filter((skill) => skill.slash !== false)
    .map((skill) => ({ name: skill.name, description: skill.description ?? "", isSkill: true }));
  return [
    ...skills,
    ...input.commands.flatMap((command) =>
      skills.some((skill) => skill.name === command.name)
        ? []
        : [{ name: command.name, description: command.description ?? "", isSkill: false }],
    ),
  ];
}

export function rankPromptCommands(
  entries: readonly PromptCommandEntry[],
  query: string,
): readonly PromptMenuItem[] {
  const needle = query.toLowerCase();
  const matches = entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  const perSection = needle.length === 0 ? PROMPT_MENU_BROWSE_PER_SECTION : PROMPT_MENU_MAX_ITEMS;
  return [
    ...matches.filter((entry) => entry.isSkill).slice(0, perSection),
    ...matches.filter((entry) => !entry.isSkill).slice(0, perSection),
  ].map((entry) => ({
    key: `command:${entry.name}`,
    title: entry.name,
    detail: entry.description.length === 0 ? null : entry.description,
    section: entry.isSkill ? "Skills" : "Commands",
    insert: `/${entry.name}`,
  }));
}

// `files.find` already ranks and caps server-side; keep its order and only mirror the cap.
export function rankPromptFiles(entries: readonly PromptFileSource[]): readonly PromptMenuItem[] {
  return entries.slice(0, PROMPT_MENU_MAX_ITEMS).map((entry) => ({
    key: `${entry.type}:${entry.path}`,
    title:
      entry.path
        .split("/")
        .filter((segment) => segment.length > 0)
        .at(-1) ?? entry.path,
    detail: entry.path,
    section: "Files & folders",
    insert: `@${entry.path}`,
  }));
}
