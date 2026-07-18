const STYLEX_CALLS = new Set([
  "create",
  "createTheme",
  "keyframes",
]);
const CROSS_ELEMENT_CALLS = new Set(["ancestor", "descendant", "sibling"]);
const BANNED_UI_IMPORTS = ["zustand", "styled-components", "@emotion", "tailwindcss", "tailwind"];
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/i;
const RAW_LENGTH = /\b(?!0(?:px|rem|em)\b)\d*\.?\d+(?:px|rem|em)\b/;
const RAW_DURATION = /\b(?!0m?s\b)\d*\.?\d+m?s\b/;
const RAW_EASING = /\b(?:cubic-bezier|steps)\(/;

function memberName(node) {
  if (node.type !== "MemberExpression") return undefined;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return undefined;
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function importIsBanned(specifier) {
  return BANNED_UI_IMPORTS.some((base) => specifier === base || specifier.startsWith(`${base}/`));
}

function isStylexCall(node) {
  return (
    node !== null &&
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "stylex" &&
    STYLEX_CALLS.has(memberName(node.callee))
  );
}

function isInsideStylexCall(node) {
  for (let current = node.parent; current != null; current = current.parent) {
    if (isStylexCall(current)) return true;
  }
  return false;
}

function isTokenBindingFile(context) {
  return context.filename.replaceAll("\\", "/").endsWith("tokens.stylex.ts");
}

function isUiSourceFile(context) {
  return context.filename.replaceAll("\\", "/").includes("/packages/ui/src/");
}

function isUiPackageFile(context) {
  const filename = context.filename.replaceAll("\\", "/");
  return filename.includes("/packages/ui/src/") || filename.includes("/packages/ui/dev/");
}

function isAppSourceFile(context) {
  return context.filename.replaceAll("\\", "/").includes("/packages/app/src/");
}

function jsxElementName(node) {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression") {
    const object = jsxElementName(node.object);
    const property = jsxElementName(node.property);
    return object === undefined || property === undefined ? undefined : `${object}.${property}`;
  }
  return undefined;
}

function jsxAttribute(opening, name) {
  return opening.attributes.find(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name,
  );
}

function reportBannedImport(context, node, specifier) {
  if (!importIsBanned(specifier)) return;
  context.report({
    node,
    message: `Banned import "${specifier}" — @honk/ui is StyleX-only and must not add a parallel styling or state system.`,
  });
}

const noUseEffect = {
  create(context) {
    return {
      CallExpression(node) {
        const direct =
          node.callee.type === "Identifier" &&
          (node.callee.name === "useEffect" || node.callee.name === "useLayoutEffect");
        const member =
          node.callee.type === "MemberExpression" &&
          (memberName(node.callee) === "useEffect" ||
            memberName(node.callee) === "useLayoutEffect");
        if (!direct && !member) return;
        context.report({
          node,
          message:
            "Effects are banned in the rewrite UI — use an external store, callback ref, useSyncExternalStore, or CSS.",
        });
      },
    };
  },
};

const noCrossElement = {
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "when" &&
          CROSS_ELEMENT_CALLS.has(memberName(node.callee))
        ) {
          context.report({
            node,
            message:
              "Cross-element StyleX selectors are unavailable here — resolve state in JavaScript or pass it through a custom property.",
          });
          return;
        }
        if (
          node.callee.type === "Identifier" &&
          (node.callee.name === "defineMarker" || node.callee.name === "defaultMarker")
        ) {
          context.report({
            node,
            message:
              "StyleX markers are unavailable here — resolve cross-element state in JavaScript or through a custom property.",
          });
        }
      },
    };
  },
};

const noContainerQueries = {
  create(context) {
    return {
      Property(node) {
        const key =
          node.key.type === "Identifier" && !node.computed ? node.key.name : staticString(node.key);
        if (typeof key !== "string" || !key.startsWith("@container")) return;
        context.report({
          node,
          message:
            "Container queries are not verified on the pinned StyleX version — measure with a callback-ref ResizeObserver.",
        });
      },
    };
  },
};

const noBannedImports = {
  create(context) {
    if (!isUiPackageFile(context)) return {};
    return {
      ImportDeclaration(node) {
        const specifier = staticString(node.source);
        if (specifier !== undefined) reportBannedImport(context, node.source, specifier);
      },
      ExportNamedDeclaration(node) {
        const specifier = staticString(node.source);
        if (specifier !== undefined) reportBannedImport(context, node.source, specifier);
      },
      ExportAllDeclaration(node) {
        const specifier = staticString(node.source);
        if (specifier !== undefined) reportBannedImport(context, node.source, specifier);
      },
      ImportExpression(node) {
        const specifier = staticString(node.source);
        if (specifier !== undefined) reportBannedImport(context, node.source, specifier);
      },
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "require" ||
          node.arguments.length === 0
        ) {
          return;
        }
        const specifier = staticString(node.arguments[0]);
        if (specifier !== undefined) reportBannedImport(context, node.arguments[0], specifier);
      },
    };
  },
};

const noHostStyling = {
  create(context) {
    if (
      !isUiSourceFile(context) ||
      /\.(?:native|ios|android)\.[cm]?[jt]sx?$/.test(context.filename)
    ) {
      return {};
    }
    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          (node.name.name !== "className" && node.name.name !== "style")
        ) {
          return;
        }
        const opening = node.parent;
        if (opening.type !== "JSXOpeningElement" || opening.name.type !== "JSXIdentifier") return;
        if (!/^[a-z]/.test(opening.name.name)) return;
        context.report({
          node,
          message:
            node.name.name === "className"
              ? "Do not style web host elements with className — spread stylex.props(...) instead."
              : "Do not style web host elements with style — spread stylex.props(...); the style prop is only a public @honk/ui boundary.",
        });
      },
    };
  },
};

const noBorderShorthand = {
  create(context) {
    return {
      Property(node) {
        if (!isInsideStylexCall(node)) return;
        const key =
          node.key.type === "Identifier" && !node.computed ? node.key.name : staticString(node.key);
        if (key !== "border" || staticString(node.value) === "none") return;
        context.report({
          node,
          message:
            "Do not use the border shorthand in StyleX — set borderWidth, borderStyle, and borderColor separately.",
        });
      },
    };
  },
};

// Token-owned CSS properties. Raw values on these must come from a *Vars group; every other
// property (width, height, inset, transform, opacity, …) may carry inline literal intrinsics.
// Genuine intrinsics on a token-owned property take an oxlint-disable-next-line with a reason.
const TOKEN_OWNED_PROPERTIES = (() => {
  const table = new Map();
  const add = (properties, arm) => {
    for (const property of properties) table.set(property, arm);
  };
  const length = (group) => ({
    group,
    test: (value) => (typeof value === "string" ? value.match(RAW_LENGTH)?.[0] : undefined),
  });
  add(
    [
      "padding",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "paddingInline",
      "paddingInlineStart",
      "paddingInlineEnd",
      "paddingBlock",
      "paddingBlockStart",
      "paddingBlockEnd",
      "margin",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "marginInline",
      "marginInlineStart",
      "marginInlineEnd",
      "marginBlock",
      "marginBlockStart",
      "marginBlockEnd",
      "gap",
      "rowGap",
      "columnGap",
    ],
    length("a spacing token (spaceVars, or the owning surface group: controlVars/sidebarVars/conversationVars/toastVars/proseVars)"),
  );
  add(
    [
      "borderRadius",
      "borderTopLeftRadius",
      "borderTopRightRadius",
      "borderBottomLeftRadius",
      "borderBottomRightRadius",
      "borderStartStartRadius",
      "borderStartEndRadius",
      "borderEndStartRadius",
      "borderEndEndRadius",
    ],
    length("radiusVars"),
  );
  add(
    [
      "borderWidth",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderInlineStartWidth",
      "borderInlineEndWidth",
      "borderBlockStartWidth",
      "borderBlockEndWidth",
      "outlineWidth",
    ],
    length("borderVars (hairline) or controlVars border width"),
  );
  add(["fontSize", "lineHeight"], length("fontVars sizes (or the owning surface group's size/leading pair)"));
  add(["fontWeight"], {
    group: "fontVars weights",
    test: (value) => {
      const numeric = typeof value === "string" ? Number(value) : value;
      return typeof numeric === "number" && numeric >= 100 && numeric <= 900
        ? String(value)
        : undefined;
    },
  });
  add(["fontFamily"], {
    group: "fontVars families",
    test: (value) => (typeof value === "string" && value.trim() !== "" ? value : undefined),
  });
  add(
    [
      "transition",
      "transitionDuration",
      "transitionDelay",
      "animation",
      "animationDuration",
      "animationDelay",
    ],
    {
      group: "motionVars durations",
      test: (value) => (typeof value === "string" ? value.match(RAW_DURATION)?.[0] : undefined),
    },
  );
  add(["transitionTimingFunction", "animationTimingFunction"], {
    group: "motionVars eases",
    test: (value) => (typeof value === "string" ? value.match(RAW_EASING)?.[0] : undefined),
  });
  add(["boxShadow"], {
    group: "elevationVars",
    test: (value) =>
      typeof value === "string" && value !== "none" && /\d/.test(value) ? value : undefined,
  });
  add(["zIndex"], {
    group: "zVars (the overlay ladder starts at 10; local stacking below 10 is free)",
    test: (value) => {
      const numeric = typeof value === "string" ? Number(value) : value;
      return typeof numeric === "number" && Math.abs(numeric) >= 10 ? String(value) : undefined;
    },
  });
  return table;
})();

// Values that are always fine on a token-owned property.
const RAW_VALUE_ALLOWED = new Set([
  "0",
  "0px",
  "auto",
  "none",
  "normal",
  "inherit",
  "initial",
  "unset",
  "fit-content",
  "min-content",
  "max-content",
  "transparent",
  "currentColor",
]);

function unwrapExpression(node) {
  let current = node;
  while (
    current !== null &&
    current !== undefined &&
    (current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    current = current.expression;
  }
  return current;
}

// Resolves a module-level `const NAME = <literal>` initializer to its static value.
function staticInitValue(node) {
  const value = unwrapExpression(node);
  if (value === null || value === undefined) return undefined;
  if (value.type === "Literal" && (typeof value.value === "string" || typeof value.value === "number")) {
    return value.value;
  }
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return value.quasis[0]?.value.raw;
  }
  if (
    value.type === "UnaryExpression" &&
    value.operator === "-" &&
    value.argument.type === "Literal" &&
    typeof value.argument.value === "number"
  ) {
    return -value.argument.value;
  }
  return undefined;
}

function collectModuleConstants(program) {
  const constants = new Map();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier") continue;
      const value = staticInitValue(declarator.init);
      if (value !== undefined) constants.set(declarator.id.name, value);
    }
  }
  return constants;
}

function isConditionKey(property) {
  const key =
    property.key.type === "Identifier" && !property.computed
      ? property.key.name
      : staticString(property.key);
  return key === "default" || (typeof key === "string" && /^[:@]/.test(key));
}

// Yields {value, constName?} for every statically-knowable value an expression can produce,
// following ternaries, condition objects, fallback arrays, and module-const references.
function collectStaticValues(node, constants, results, constName) {
  const expression = unwrapExpression(node);
  if (expression === null || expression === undefined) return;
  switch (expression.type) {
    case "Literal":
      if (typeof expression.value === "string" || typeof expression.value === "number") {
        results.push({ node, value: expression.value, constName });
      }
      return;
    case "TemplateLiteral":
      for (const quasi of expression.quasis) {
        if (quasi.value.raw !== "") results.push({ node, value: quasi.value.raw, constName });
      }
      for (const inner of expression.expressions) {
        collectStaticValues(inner, constants, results, constName);
      }
      return;
    case "Identifier": {
      const value = constants.get(expression.name);
      if (value !== undefined) results.push({ node, value, constName: expression.name });
      return;
    }
    case "UnaryExpression":
      if (expression.operator === "-") {
        const before = results.length;
        collectStaticValues(expression.argument, constants, results, constName);
        for (let index = before; index < results.length; index += 1) {
          const entry = results[index];
          if (typeof entry.value === "number") entry.value = -entry.value;
        }
      }
      return;
    case "ConditionalExpression":
      collectStaticValues(expression.consequent, constants, results, constName);
      collectStaticValues(expression.alternate, constants, results, constName);
      return;
    case "LogicalExpression":
      collectStaticValues(expression.left, constants, results, constName);
      collectStaticValues(expression.right, constants, results, constName);
      return;
    case "ArrayExpression":
      for (const element of expression.elements) {
        if (element !== null) collectStaticValues(element, constants, results, constName);
      }
      return;
    case "ObjectExpression":
      for (const property of expression.properties) {
        if (property.type === "Property" && isConditionKey(property)) {
          collectStaticValues(property.value, constants, results, constName);
        }
      }
      return;
    default:
      return;
  }
}

const noRawValues = {
  create(context) {
    if (isTokenBindingFile(context)) return {};
    let constants = new Map();

    function report(entry, propertyName, arm, raw) {
      const laundered =
        entry.constName === undefined
          ? ""
          : ` (via const ${entry.constName} — hoisting a literal does not tokenize it)`;
      context.report({
        node: entry.node,
        message:
          `Raw design value "${raw}" on token-owned property "${propertyName}"${laundered} — ` +
          `use ${arm.group}, or justify a fixed intrinsic with an oxlint-disable directive and a reason.`,
      });
    }

    return {
      Program(node) {
        constants = collectModuleConstants(node);
      },
      Property(node) {
        if (!isInsideStylexCall(node)) return;
        if (isConditionKey(node)) return;
        const propertyName =
          node.key.type === "Identifier" && !node.computed ? node.key.name : staticString(node.key);
        if (typeof propertyName !== "string") return;
        const arm = TOKEN_OWNED_PROPERTIES.get(propertyName);
        const values = [];
        collectStaticValues(node.value, constants, values, undefined);
        for (const entry of values) {
          const text = typeof entry.value === "string" ? entry.value.trim() : String(entry.value);
          if (RAW_VALUE_ALLOWED.has(text)) continue;
          if (typeof entry.value === "string") {
            const rawColor = entry.value.match(RAW_COLOR)?.[0];
            if (rawColor !== undefined) {
              report(
                entry,
                propertyName,
                { group: "colorVars (or elevationVars for shadow stacks)" },
                rawColor,
              );
              continue;
            }
          }
          if (arm === undefined) continue;
          const raw = arm.test(entry.value);
          if (raw !== undefined) report(entry, propertyName, arm, raw);
        }
      },
    };
  },
};

const noDuplicateDefineVars = {
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const sanctioned =
      filename.endsWith("/packages/ui/src/platform-tokens.stylex.ts") ||
      filename.endsWith("/packages/ui/src/tokens.stylex.ts");
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "Identifier" ||
          node.callee.object.name !== "stylex" ||
          memberName(node.callee) !== "defineVars" ||
          sanctioned
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Authored StyleX variable groups belong in tokens.stylex.ts; shared generated groups belong in platform-tokens.stylex.ts.",
        });
      },
    };
  },
};

const noNullStylexOverrides = {
  create(context) {
    function containsNull(node) {
      if (node === null || node === undefined) return false;
      if (node.type === "Literal") return node.value === null;
      if (node.type === "ConditionalExpression") {
        return containsNull(node.consequent) || containsNull(node.alternate);
      }
      if (node.type === "LogicalExpression") {
        return containsNull(node.left) || containsNull(node.right);
      }
      if (node.type === "ArrayExpression") return node.elements.some(containsNull);
      return false;
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "Identifier" ||
          node.callee.object.name !== "stylex" ||
          memberName(node.callee) !== "props"
        ) {
          return;
        }
        for (const argument of node.arguments) {
          if (!containsNull(argument)) continue;
          context.report({
            node: argument,
            message:
              "Do not pass null through stylex.props; use false/undefined so optional StyleX composition has one convention.",
          });
        }
      },
    };
  },
};

const noCanonicalControlOverrides = {
  create(context) {
    const canonical = new Set([
      "Button",
      "IconButton",
      "ListRow",
      "Picker.Trigger",
      "Picker.Option",
      "Menu.Item",
    ]);
    return {
      JSXOpeningElement(node) {
        const name = jsxElementName(node.name);
        if (name === undefined || !canonical.has(name)) return;
        const style = jsxAttribute(node, "style");
        if (style === undefined) return;
        context.report({
          node: style,
          message: `${name} owns its visual chrome; style a layout wrapper instead of overriding the control at the call site.`,
        });
      },
    };
  },
};

const noRawButton = {
  create(context) {
    if (!isAppSourceFile(context)) return {};
    return {
      JSXOpeningElement(node) {
        if (jsxElementName(node.name) !== "button") return;
        if (jsxAttribute(node, "data-canonical-control-exception") !== undefined) return;
        const role = jsxAttribute(node, "role");
        const roleValue = role?.value?.type === "Literal" ? role.value.value : undefined;
        if (roleValue === "option" || roleValue === "radio" || roleValue === "checkbox") return;
        context.report({
          node,
          message:
            "Use @honk/ui Button/IconButton/ListRow for interactive controls, or mark a focus-sensitive composite with data-canonical-control-exception and a concrete reason.",
        });
      },
    };
  },
};

const effectV4Syntax = {
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "Identifier" ||
          node.callee.object.name !== "Effect"
        ) {
          return;
        }
        const method = memberName(node.callee);
        if (method === "catchAll") {
          context.report({
            node,
            message: "Effect v4 uses Effect.catch; Effect.catchAll is a retired API.",
          });
          return;
        }
        if (method === "tryPromise" && node.arguments[0]?.type !== "ObjectExpression") {
          context.report({
            node,
            message:
              "Use the Effect v4 options form Effect.tryPromise({ try, catch }) so promise failures remain typed.",
          });
        }
      },
    };
  },
};

export default {
  meta: {
    name: "honk",
  },
  rules: {
    "design-no-banned-imports": noBannedImports,
    "design-no-border-shorthand": noBorderShorthand,
    "design-no-container-queries": noContainerQueries,
    "design-no-cross-element": noCrossElement,
    "design-no-canonical-control-overrides": noCanonicalControlOverrides,
    "design-no-duplicate-define-vars": noDuplicateDefineVars,
    "design-no-host-styling": noHostStyling,
    "design-no-null-stylex-overrides": noNullStylexOverrides,
    "design-no-raw-button": noRawButton,
    "design-no-raw-values": noRawValues,
    "design-no-use-effect": noUseEffect,
    "effect-v4-syntax": effectV4Syntax,
  },
};
