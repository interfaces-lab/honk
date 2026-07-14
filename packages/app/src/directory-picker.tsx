import * as stylex from "@stylexjs/stylex";
import { Button, Field, Icon, ListRow, Separator, Text } from "@honk/ui";
import { IconFolder1, IconFolderOpen } from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

const PICKER_WIDTH = "360px";
const PICKER_MAX_HEIGHT = "320px";
const RECENT_LIST_MAX_HEIGHT = "200px";
const EMPTY_DIRECTORY_PATHS: readonly string[] = Object.freeze([]);

const styles = stylex.create({
  root: {
    width: PICKER_WIDTH,
    maxWidth: "100%",
    maxHeight: PICKER_MAX_HEIGHT,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  sectionLabel: {
    paddingInline: spaceVars["--honk-space-control-pad-x"],
  },
  rows: {
    minHeight: 0,
    maxHeight: RECENT_LIST_MAX_HEIGHT,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    scrollbarWidth: "thin",
  },
  empty: {
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  footer: {
    display: "flex",
    flexDirection: "column",
  },
});

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() ?? path;
}

function looksLikeDirectoryPath(value: string): boolean {
  return (
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function DirectoryPicker({
  recentDirectories,
  excludedDirectories = EMPTY_DIRECTORY_PATHS,
  allowDirectPath = true,
  isPending = false,
  onSelect,
  onBrowse,
}: {
  readonly recentDirectories: readonly string[];
  readonly excludedDirectories?: readonly string[];
  readonly allowDirectPath?: boolean;
  readonly isPending?: boolean;
  readonly onSelect: (path: string) => void;
  readonly onBrowse?: () => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDirectories = recentDirectories.filter(
    (path) =>
      !excludedDirectories.includes(path) &&
      (normalizedQuery.length === 0 || path.toLowerCase().includes(normalizedQuery)),
  );
  const directPath = query.trim();
  const canSubmitDirectPath = allowDirectPath && looksLikeDirectoryPath(directPath);

  const submit = (): void => {
    if (isPending) {
      return;
    }
    if (canSubmitDirectPath) {
      onSelect(directPath);
      return;
    }
    const first = visibleDirectories[0];
    if (first !== undefined) {
      onSelect(first);
    }
  };

  return (
    <div data-directory-picker="" {...stylex.props(styles.root)}>
      <form
        {...stylex.props(styles.searchRow)}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }}
      >
        <Field>
          <Field.Input
            autoFocus
            aria-label={
              allowDirectPath ? "Search folders or enter a path" : "Search recent folders"
            }
            placeholder={
              allowDirectPath ? "Search folders or enter a path…" : "Search recent folders…"
            }
            value={query}
            disabled={isPending}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={isPending || (!canSubmitDirectPath && visibleDirectories.length === 0)}
        >
          Add
        </Button>
      </form>

      <Text as="div" size="xs" tone="faint" weight="medium" xstyle={styles.sectionLabel}>
        Recents
      </Text>
      <div {...stylex.props(styles.rows)}>
        {visibleDirectories.length === 0 ? (
          <div {...stylex.props(styles.empty)}>
            {canSubmitDirectPath
              ? "Press Enter to attach this path."
              : "No matching recent folders."}
          </div>
        ) : (
          visibleDirectories.map((path) => (
            <ListRow
              key={path}
              disabled={isPending}
              onClick={() => {
                onSelect(path);
              }}
            >
              <ListRow.Slot>
                <Icon icon={IconFolder1} size="sm" tone="muted" />
              </ListRow.Slot>
              <ListRow.Title>{basename(path)}</ListRow.Title>
              <ListRow.Subtitle>{path}</ListRow.Subtitle>
            </ListRow>
          ))
        )}
      </div>

      {onBrowse !== undefined ? (
        <div {...stylex.props(styles.footer)}>
          <Separator />
          <ListRow disabled={isPending} onClick={onBrowse}>
            <ListRow.Slot>
              <Icon icon={IconFolderOpen} size="sm" tone="muted" />
            </ListRow.Slot>
            <ListRow.Title>Open Folder…</ListRow.Title>
          </ListRow>
        </div>
      ) : null}
    </div>
  );
}

export { DirectoryPicker };
