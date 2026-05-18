const COMPILER_METHODS = new Set([
  "is",
  "asserts",
  "decodeEffect",
  "decodeExit",
  "decodeOption",
  "decodePromise",
  "decodeSync",
  "decodeUnknownExit",
  "decodeUnknownEffect",
  "decodeUnknownOption",
  "decodeUnknownPromise",
  "decodeUnknownSync",
  "encodeExit",
  "encodeEffect",
  "encodeOption",
  "encodePromise",
  "encodeSync",
  "encodeUnknownExit",
  "encodeUnknownEffect",
  "encodeUnknownOption",
  "encodeUnknownPromise",
  "encodeUnknownSync",
]);
const APP_SRC_SEGMENT = "packages/app/src/";
const SERVER_SRC_SEGMENT = "packages/server/src/";
const MOUNT_EFFECT_WRAPPER_SUFFIX = "packages/app/src/hooks/use-mount-effect.ts";
const SERVER_RUNTIME_SUFFIX = "packages/server/src/server-runtime.ts";

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === "ChainExpression" ||
      current.type === "ParenthesizedExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSTypeAssertion")
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function isIdentifier(node, name) {
  const expression = unwrapExpression(node);
  return expression?.type === "Identifier" && expression.name === name;
}

function getPropertyName(node) {
  const property = unwrapExpression(node);
  if (!property) return null;
  if (property.type === "Identifier") return property.name;
  if (property.type === "PrivateIdentifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  if (property.type === "StringLiteral") return property.value;
  return null;
}

function normalizedFilename(filename) {
  return filename.replaceAll("\\", "/");
}

function isAppSourceFile(filename) {
  const normalized = normalizedFilename(filename);
  return (
    (normalized.includes(`/${APP_SRC_SEGMENT}`) || normalized.startsWith(APP_SRC_SEGMENT)) &&
    !/\.test\.[cm]?[jt]sx?$/.test(normalized) &&
    !/\.browser\.[cm]?[jt]sx?$/.test(normalized)
  );
}

function isServerSourceFile(filename) {
  const normalized = normalizedFilename(filename);
  return (
    (normalized.includes(`/${SERVER_SRC_SEGMENT}`) || normalized.startsWith(SERVER_SRC_SEGMENT)) &&
    !/\.test\.[cm]?[jt]sx?$/.test(normalized)
  );
}

function isMountEffectWrapperFile(filename) {
  return normalizedFilename(filename).endsWith(MOUNT_EFFECT_WRAPPER_SUFFIX);
}

function isServerRuntimeFile(filename) {
  return normalizedFilename(filename).endsWith(SERVER_RUNTIME_SUFFIX);
}

function getSchemaCompilerMethod(callee) {
  const expression = unwrapExpression(callee);
  if (!expression || expression.type !== "MemberExpression") return null;

  if (!isIdentifier(expression.object, "Schema")) return null;

  const method = getPropertyName(expression.property);
  return method && COMPILER_METHODS.has(method) ? method : null;
}

function isStaticSchemaReference(node) {
  const expression = unwrapExpression(node);
  if (!expression) return false;

  if (expression.type === "Identifier") {
    const firstChar = expression.name[0];
    return firstChar !== undefined && firstChar.toUpperCase() === firstChar;
  }

  return expression.type === "MemberExpression";
}

function isNestedStaticSchemaCall(node) {
  const expression = unwrapExpression(node);
  if (!expression || expression.type !== "CallExpression") return false;

  const callee = unwrapExpression(expression.callee);
  if (!callee || callee.type !== "MemberExpression") return false;
  if (!isIdentifier(callee.object, "Schema")) return false;

  const method = getPropertyName(callee.property);
  if (method === "fromJsonString") {
    const firstArg = expression.arguments[0];
    return isStaticSchemaReference(firstArg) || isNestedStaticSchemaCall(firstArg);
  }

  return true;
}

function isImmediatelyInvoked(node) {
  const expression = unwrapExpression(node);
  const parent = unwrapExpression(expression?.parent);
  return parent?.type === "CallExpression" && unwrapExpression(parent.callee) === expression;
}

function messageHigh(method) {
  return `Hoist Schema.${method}(...) to module scope: both the inline schema literal and the compiled function are rebuilt on every call. Move the compiled function to a module-level const.`;
}

function messageMedium(method) {
  return `Hoist Schema.${method}(...) to module scope: the compiled function is rebuilt on every call. Move it to a module-level const.`;
}

const noInlineSchemaCompile = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect Schema decoder/encoder compiler calls inside function bodies; hoist them to module scope.",
    },
  },
  create(context) {
    let functionDepth = 0;

    return {
      FunctionDeclaration() {
        functionDepth += 1;
      },
      "FunctionDeclaration:exit"() {
        functionDepth -= 1;
      },
      FunctionExpression() {
        functionDepth += 1;
      },
      "FunctionExpression:exit"() {
        functionDepth -= 1;
      },
      ArrowFunctionExpression() {
        functionDepth += 1;
      },
      "ArrowFunctionExpression:exit"() {
        functionDepth -= 1;
      },
      CallExpression(node) {
        if (functionDepth === 0) return;

        const method = getSchemaCompilerMethod(node.callee);
        if (!method) return;
        if (!isImmediatelyInvoked(node)) return;

        const firstArg = node.arguments[0];
        const highConfidence = firstArg && isNestedStaticSchemaCall(firstArg);
        if (!highConfidence && !isStaticSchemaReference(firstArg)) return;

        context.report({
          node: node.callee,
          message: highConfidence ? messageHigh(method) : messageMedium(method),
        });
      },
    };
  },
};

const noDirectUseEffect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct React useEffect in app source; use useMountEffect for mount-only external sync or remove the effect.",
    },
  },
  create(context) {
    const filename = context.filename;
    if (!isAppSourceFile(filename) || isMountEffectWrapperFile(filename)) {
      return {};
    }

    const useEffectLocalNames = new Set();
    const reactObjectNames = new Set();

    function reportDirectUseEffect(node) {
      context.report({
        node,
        message:
          "Do not call React useEffect directly in app source. Derive state during render, use an event/keyed boundary, or use useMountEffect for mount-only external sync.",
      });
    }

    return {
      ImportDeclaration(node) {
        if (node.source?.value !== "react") {
          return;
        }

        for (const specifier of node.specifiers ?? []) {
          if (specifier.type === "ImportSpecifier") {
            const imported = getPropertyName(specifier.imported);
            if (imported === "useEffect") {
              useEffectLocalNames.add(specifier.local.name);
              context.report({
                node: specifier,
                message:
                  "Do not import React useEffect directly in app source. Import useMountEffect for mount-only external sync.",
              });
            }
            continue;
          }

          if (
            specifier.type === "ImportNamespaceSpecifier" ||
            specifier.type === "ImportDefaultSpecifier"
          ) {
            reactObjectNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (!callee) {
          return;
        }

        if (callee.type === "Identifier" && useEffectLocalNames.has(callee.name)) {
          reportDirectUseEffect(callee);
          return;
        }

        if (callee.type !== "MemberExpression") {
          return;
        }

        if (getPropertyName(callee.property) !== "useEffect") {
          return;
        }

        const object = unwrapExpression(callee.object);
        if (object?.type === "Identifier" && reactObjectNames.has(object.name)) {
          reportDirectUseEffect(callee.property);
        }
      },
    };
  },
};

const noServiceLocalRuntimeFacade = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow service-local Effect runtimes in server source; use the central ServerRuntime boundary.",
    },
  },
  create(context) {
    const filename = context.filename;
    if (!isServerSourceFile(filename) || isServerRuntimeFile(filename)) {
      return {};
    }

    const managedRuntimeLocalNames = new Set(["ManagedRuntime"]);

    function reportRuntimeFacade(node) {
      context.report({
        node,
        message:
          "Do not create service-local Effect runtimes in server source. Use packages/server/src/server-runtime.ts as the central runtime boundary.",
      });
    }

    return {
      ImportDeclaration(node) {
        if (node.source?.value !== "effect") {
          return;
        }

        for (const specifier of node.specifiers ?? []) {
          if (specifier.type !== "ImportSpecifier") {
            continue;
          }
          const imported = getPropertyName(specifier.imported);
          if (imported === "ManagedRuntime") {
            managedRuntimeLocalNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (!callee) {
          return;
        }

        if (callee.type === "Identifier" && callee.name === "makeRuntime") {
          reportRuntimeFacade(callee);
          return;
        }

        if (callee.type !== "MemberExpression") {
          return;
        }
        if (getPropertyName(callee.property) !== "make") {
          return;
        }

        const object = unwrapExpression(callee.object);
        if (object?.type === "Identifier" && managedRuntimeLocalNames.has(object.name)) {
          reportRuntimeFacade(callee.property);
        }
      },
    };
  },
};

export default {
  meta: {
    name: "multi",
  },
  rules: {
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-direct-use-effect": noDirectUseEffect,
    "no-service-local-runtime-facade": noServiceLocalRuntimeFacade,
  },
};
