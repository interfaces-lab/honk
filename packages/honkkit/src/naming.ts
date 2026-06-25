const NAMESPACE = "honk";

const classPrefix = NAMESPACE;
const dataAttrNamespace = NAMESPACE;
const cssVarNamespace = NAMESPACE;

function stableClassName(component: string): string {
  return `${classPrefix}-${component}`;
}

function dataAttr(name: string): `data-${string}` {
  return `data-${dataAttrNamespace}-${name}`;
}

function cssVar(name: string): string {
  return `--${cssVarNamespace}-${name}`;
}

export {
  NAMESPACE,
  classPrefix,
  cssVar,
  cssVarNamespace,
  dataAttr,
  dataAttrNamespace,
  stableClassName,
};
