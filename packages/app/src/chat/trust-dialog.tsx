// The workspace-trust decision, in the shape VS Code established: a modal
// asking about the *authors* of the folder, each choice carrying its
// consequence. Honk has no restricted mode — an untrusted folder simply stays
// closed — so declining returns to the picker instead of a limited view.

import { Button, Dialog, Text } from "@honk/ui";
import { colorVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

const TRUST_DIALOG_MAX_WIDTH = "440px";

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    maxWidth: TRUST_DIALOG_MAX_WIDTH,
  },
  path: {
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    overflowWrap: "anywhere",
    paddingBlock: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-chrome"],
  },
  choices: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    marginBlockStart: spaceVars["--honk-space-gutter"],
  },
  choice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  caption: {
    textAlign: "center",
    marginBlockStart: spaceVars["--honk-space-gutter"],
  },
});

export function TrustDialog({
  directory,
  onTrust,
  onDecline,
}: {
  readonly directory: string;
  readonly onTrust: () => void;
  readonly onDecline: () => void;
}): React.ReactElement {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onDecline();
      }}
    >
      <Dialog.Popup>
        <div {...stylex.props(styles.body)}>
          <Dialog.Title>Do you trust the authors of the files in this folder?</Dialog.Title>
          <div {...stylex.props(styles.path)}>{directory}</div>
          <Dialog.Description>
            Agents in a trusted folder read and change files and run commands. Honk remembers this
            decision for this folder.
          </Dialog.Description>
          <div {...stylex.props(styles.choices)}>
            <div {...stylex.props(styles.choice)}>
              <Button variant="primary" onClick={onTrust}>
                Yes, I trust the authors
              </Button>
              <div {...stylex.props(styles.caption)}>
                <Text as="p" size="xs" tone="muted">
                  Trust this folder and start working in it
                </Text>
              </div>
            </div>
            <div {...stylex.props(styles.choice)}>
              <Button variant="quiet" onClick={onDecline}>
                No, I don't trust the authors
              </Button>
              <div {...stylex.props(styles.caption)}>
                <Text as="p" size="xs" tone="muted">
                  Go back and choose a different folder
                </Text>
              </div>
            </div>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
