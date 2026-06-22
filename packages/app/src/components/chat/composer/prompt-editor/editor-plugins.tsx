import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";

import { ComposerCommandKeyPlugin } from "./command-key-plugin";
import {
  ComposerInlineTokenArrowPlugin,
  ComposerInlineTokenBackspacePlugin,
  ComposerInlineTokenSelectionNormalizePlugin,
} from "./inline-token-plugins";
import type { ComposerPromptEditorPluginHelpers } from "./plugin-types";
import { ComposerSurroundSelectionPlugin } from "./surround-selection-plugin";

export function ComposerPromptEditorPlugins(props: ComposerPromptEditorPluginHelpers) {
  return (
    <>
      <ComposerCommandKeyPlugin
        onCommandKeyDownRef={props.onCommandKeyDownRef}
        pendingSurroundSelectionRef={props.pendingSurroundSelectionRef}
      />
      <ComposerSurroundSelectionPlugin
        applySurroundInput={props.applySurroundInput}
        backtickSurroundCloseSymbol={props.backtickSurroundCloseSymbol}
        captureSurroundSelection={props.captureSurroundSelection}
        pendingSurroundSelectionRef={props.pendingSurroundSelectionRef}
        setSelectionRangeAtTextOffsets={props.setSelectionRangeAtTextOffsets}
        surroundSymbolsMap={props.surroundSymbolsMap}
      />
      <ComposerInlineTokenArrowPlugin
        readCollapsedLengthFromEditorState={props.readCollapsedLengthFromEditorState}
        readSnapshotFromEditorState={props.readSnapshotFromEditorState}
        setSelectionAtTextOffset={props.setSelectionAtTextOffset}
      />
      <ComposerInlineTokenSelectionNormalizePlugin
        isComposerAtomNode={props.isComposerAtomNode}
        offsetBeforePoint={props.offsetBeforePoint}
        pointAroundNode={props.pointAroundNode}
        setSelectionAtTextOffset={props.setSelectionAtTextOffset}
      />
      <ComposerInlineTokenBackspacePlugin
        isComposerAtomNode={props.isComposerAtomNode}
        offsetBeforePoint={props.offsetBeforePoint}
        pointAroundNode={props.pointAroundNode}
        setSelectionAtTextOffset={props.setSelectionAtTextOffset}
      />
      <HistoryPlugin />
    </>
  );
}
