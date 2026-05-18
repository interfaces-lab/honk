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

export default {
  meta: {
    name: "multi",
  },
  rules: {
    "no-inline-schema-compile": noInlineSchemaCompile,
  },
};
