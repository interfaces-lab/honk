import { stableClassName } from "../naming";

type ClassValue = string | number | undefined | null;
type ClassProps = Record<string, ClassValue>;
type ThemeDataAttributes = Record<`data-${string}`, string | undefined>;
type ThemeProps = { className: string } & ThemeDataAttributes;

function toDataAttributeName(prop: string): `data-${string}` {
  return `data-${prop.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function classTokenForPropValue(prop: string, value: string): string {
  return /^\d/.test(value) ? `${prop}-${value}` : value;
}

function buildClassName(component: string, props?: ClassProps): string {
  const classes = [stableClassName(component)];

  if (props) {
    for (const [prop, value] of Object.entries(props)) {
      if (value == null) {
        continue;
      }
      classes.push(classTokenForPropValue(prop, String(value)));
    }
  }

  return classes.join(" ");
}

function themeDataAttributes(props?: ClassProps): ThemeDataAttributes {
  const attrs: ThemeDataAttributes = {};

  if (props) {
    for (const [prop, value] of Object.entries(props)) {
      if (value == null) {
        continue;
      }
      attrs[toDataAttributeName(prop)] = String(value);
    }
  }

  return attrs;
}

function themeProps(component: string, props?: ClassProps): ThemeProps {
  return {
    className: buildClassName(component, props),
    ...themeDataAttributes(props),
  };
}

export { themeDataAttributes, themeProps };
export type { ClassProps, ThemeDataAttributes, ThemeProps };
