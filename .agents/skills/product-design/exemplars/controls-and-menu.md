# Controls and menu behavior

**Evidence:** `packages/ui/dev/main.tsx` control matrix and `packages/ui/src/menu.tsx`.

The matrix places selected, hovered, disabled, compact, rich, narrow, and long-label states together so
the control family can be judged as one hierarchy. Commands use Button variants; values use Picker;
persistent navigation uses ListRow; transient one-line commands use Menu.Item. Callers wrap for layout
without repainting shared chrome.

Menu demonstrates on-self state attributes, Base UI starting/ending transition attributes, and paired
reduced-motion behavior. This is evidence for compatible headless transitions, not permission to copy
menu animation onto unrelated surfaces.
