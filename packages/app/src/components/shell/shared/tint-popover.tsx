import { Popover } from "@base-ui/react/popover";
import { IconChevronDownSmall } from "central-icons";

import { buttonVariants } from "@multi/ui/button";
import { TINT_PAD, tintPreviewCss } from "~/lib/ui-tint";
import { cn } from "~/lib/utils";

import { TintPad } from "./tint-pad";

export function TintPopover(props: {
  hue: number;
  saturation: number;
  disabled?: boolean;
  onHueChange: (value: number) => void;
  onSatChange: (value: number) => void;
}) {
  const fill = tintPreviewCss(props.hue, props.saturation);

  return (
    <Popover.Root modal={false}>
      <Popover.Trigger
        aria-label="Hue and saturation"
        disabled={props.disabled}
        className={cn(
          buttonVariants({ variant: "outline", size: "xs" }),
          "gap-0.5 pr-1.5 pl-0.5 [&_svg]:opacity-70",
        )}
      >
        <span
          aria-hidden
          className="size-5 shrink-0 rounded-sm border border-white/25 shadow-[inset_0_1px_2px_rgb(0_0_0/0.12)] dark:border-white/10"
          style={{ background: fill }}
        />
        <IconChevronDownSmall className="size-3.5 shrink-0" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50 outline-none" side="bottom" sideOffset={8}>
          <Popover.Popup
            initialFocus={false}
            className="origin-(--transform-origin) overflow-hidden rounded-multi-card border border-multi-stroke bg-multi-bubble p-0 shadow-multi-popup backdrop-blur-xl"
            style={{ width: TINT_PAD.w }}
          >
            <TintPad
              disabled={props.disabled ?? false}
              hue={props.hue}
              saturation={props.saturation}
              onHueChange={props.onHueChange}
              onSatChange={props.onSatChange}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
