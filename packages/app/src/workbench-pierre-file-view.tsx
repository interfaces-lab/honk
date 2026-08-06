import { fontVars } from "@honk/ui/tokens.stylex";
import { Editor, type EditorOptions } from "@pierre/diffs/edit";
import type { CodeViewFileItem, CodeViewReactOptions } from "@pierre/diffs/react";
import { CodeView, EditProvider } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { useAppearance } from "./appearance-store";
import { PIERRE_DIFF_THEME_CSS, resolveDiffThemeName } from "./lib/diff-rendering";
import { useResolvedTheme } from "./lib/use-resolved-theme";

// Pierre owns the code surface's shadow tree. Keep the adapter limited to stable data attributes
// and Honk's existing token vocabulary; the package docs explicitly warn against structural
// selectors in unsafe CSS.
const PIERRE_FILE_UNSAFE_CSS = `${PIERRE_DIFF_THEME_CSS}
:host {
  min-width: 0;
  max-width: 100%;
  --diffs-line-height: var(--honk-leading-code);
}

[data-file],
[data-code],
[data-content],
[data-gutter] {
  min-width: 0;
}

[data-code] {
  line-height: var(--diffs-line-height);
}

[data-line] {
  min-height: var(--diffs-line-height);
}
`;

const styles = stylex.create({
  // Cursor's code defaults on macOS are 12px at the 1.5 golden line-height ratio (spec JS 1009203 /
  // 1425741) = 18px. Honk already tokenizes both, and Pierre inherits them from this scrollport.
  editor: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "auto",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
    lineHeight: fontVars["--honk-leading-code"],
  },
});

function WorkbenchPierreFileView({
  path,
  text,
  onChange,
}: {
  readonly path: string;
  readonly text: string;
  readonly onChange: (text: string) => void;
}): React.ReactElement {
  const theme = useResolvedTheme();
  const appearance = useAppearance();
  // React Compiler keeps these props referentially stable for Pierre's controlled reconciler.
  const items: readonly CodeViewFileItem<undefined>[] = [
    {
      id: path,
      type: "file",
      file: {
        name: path,
        contents: text,
        cacheKey: `${path}:${String(fileVersion(path, text))}`,
      },
      version: fileVersion(path, text),
      edit: true,
    },
  ];
  const options: CodeViewReactOptions<undefined> = {
    theme: resolveDiffThemeName(theme),
    themeType: theme,
    preferredHighlighter: "shiki-js",
    overflow: "scroll",
    disableFileHeader: true,
    unsafeCSS: PIERRE_FILE_UNSAFE_CSS,
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    itemMetrics: { lineHeight: appearance.codeFontSize + 6 },
  };

  return (
    <EditProvider createEditor={createPierreEditor}>
      <CodeView
        items={items}
        options={options}
        onItemEditChange={(_item, file) => {
          onChange(file.contents);
        }}
        {...stylex.props(styles.editor)}
      />
    </EditProvider>
  );
}

function createPierreEditor(options: EditorOptions<undefined>): Editor<undefined> {
  return new Editor(options);
}

function fileVersion(path: string, text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  hash ^= 0;
  hash = Math.imul(hash, 16_777_619);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export { WorkbenchPierreFileView };
