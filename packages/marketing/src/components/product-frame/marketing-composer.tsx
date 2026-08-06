import * as stylex from "@stylexjs/stylex";
import { Icon } from "@honk/ui/icon";
import { IconButton } from "@honk/ui/button";
import { Text } from "@honk/ui/text";
import {
  colorVars,
  composerVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import { IconArrowUp, IconOpenaiCodex, IconPlusSmall } from "central-icons";
import { useState } from "react";

// Mirrors the collapsed thread composer in app/src/thread/composer.tsx: a 1px inset ring
// instead of a border, plus the fixed editor intrinsics that no spacing token owns.
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;
const COMPOSER_COLLAPSED_PADDING_INLINE = "10px";
const COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE = "4px";
const COMPOSER_EDITOR_LINE_HEIGHT = "20px";
const COMPOSER_EDITOR_MAX_HEIGHT = "120px";

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
  },
  inputBox: {
    flexShrink: 0,
    minHeight: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  inputRow: {
    minHeight: composerVars["--honk-composer-state-band-height"],
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: COMPOSER_COLLAPSED_PADDING_INLINE,
  },
  editor: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    appearance: "none",
    resize: "none",
    borderStyle: "none",
    outline: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    minHeight: COMPOSER_EDITOR_LINE_HEIGHT,
    maxHeight: COMPOSER_EDITOR_MAX_HEIGHT,
    paddingBlock: 0,
    paddingInline: COMPOSER_EDITOR_COLLAPSED_PADDING_INLINE,
    overflowY: "auto",
    "::placeholder": { color: colorVars["--honk-color-text-faint"] },
  },
  controls: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  modelIndicator: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  submitPaint: {
    display: "inline-flex",
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  submitEnabled: { backgroundColor: colorVars["--honk-color-text-primary"] },
  submitDisabled: { backgroundColor: colorVars["--honk-color-layer-03"] },
});

export function MarketingComposer(props: { onSubmit: (text: string) => void; busy: boolean }) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !props.busy;

  const submit = () => {
    if (!canSend) return;
    props.onSubmit(draft.trim());
    setDraft("");
  };

  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div data-thread-composer-input="" {...stylex.props(styles.inputBox)}>
        <div {...stylex.props(styles.inputRow)}>
          <textarea
            aria-label="Message the Honk demo"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask the demo anything"
            {...stylex.props(styles.editor)}
          />
          <div {...stylex.props(styles.controls)}>
            <IconButton type="button" size="sm" variant="quiet" aria-label="Add attachments">
              <Icon icon={IconPlusSmall} size="sm" />
            </IconButton>
            <span {...stylex.props(styles.modelIndicator)}>
              <Icon icon={IconOpenaiCodex} size="sm" tone="muted" />
              <Text size="xs" tone="muted">
                Sol · High
              </Text>
            </span>
            <span
              {...stylex.props(
                styles.submitPaint,
                canSend ? styles.submitEnabled : styles.submitDisabled,
              )}
            >
              <IconButton
                type="submit"
                size="sm"
                variant="quiet"
                aria-label="Send"
                disabled={!canSend}
              >
                <Icon
                  icon={IconArrowUp}
                  size="sm"
                  style={{
                    color: canSend
                      ? colorVars["--honk-color-bg-base"]
                      : colorVars["--honk-color-text-primary"],
                  }}
                />
              </IconButton>
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
