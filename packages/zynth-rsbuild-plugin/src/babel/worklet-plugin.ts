import type { PluginObj, PluginPass } from "@babel/core";
import type { BlockStatement } from "@babel/types";

type BabelAPI = typeof import("@babel/core");

type WorkletState = PluginPass & {
  createInputHandlerLocalNames?: Set<string>;
  file: {
    opts: {
      filename?: string;
    };
  };
};

function getLocation(state: WorkletState, line?: number, column?: number): string {
  const filename = state.file?.opts?.filename ?? "unknown";
  if (typeof line === "number" && typeof column === "number") {
    return `${filename}:${line}:${column}`;
  }
  return filename;
}

export function createWorkletBabelPlugin() {
  return function workletPlugin(babel: BabelAPI): PluginObj<WorkletState> {
    const t = babel.types;

    const hasWorkletDirective = (body: BlockStatement): boolean => {
      if (Array.isArray(body.directives)) {
        if (body.directives.some((directive) => directive.value.value === "worklet")) {
          return true;
        }
      }
      if (!body.body.length) return false;
      const first = body.body[0];
      return (
        t.isExpressionStatement(first) &&
        t.isStringLiteral(first.expression, { value: "worklet" })
      );
    };

    const stripWorkletDirective = (body: BlockStatement): void => {
      const first = body.body[0];
      if (
        first &&
        t.isExpressionStatement(first) &&
        t.isStringLiteral(first.expression, { value: "worklet" })
      ) {
        body.body.shift();
      }
      if (Array.isArray(body.directives) && body.directives.length > 0) {
        body.directives = body.directives.filter(
          (directive) => directive.value.value !== "worklet"
        );
      }
    };

    return {
      name: "zynth-worklet",
      visitor: {
        Program: {
          enter(path, state) {
            const localNames = new Set<string>();
            for (const statement of path.node.body) {
              if (!t.isImportDeclaration(statement)) continue;
              if (statement.source.value !== "@zynth/core") continue;
              for (const specifier of statement.specifiers) {
                if (!t.isImportSpecifier(specifier)) continue;
                if (!t.isIdentifier(specifier.imported, { name: "createInputHandler" })) {
                  continue;
                }
                localNames.add(specifier.local.name);
              }
            }
            state.createInputHandlerLocalNames = localNames;
          },
        },
        CallExpression(path, state) {
          const localNames = state.createInputHandlerLocalNames;
          if (!localNames || localNames.size === 0) return;
          const callee = path.node.callee;
          if (!t.isIdentifier(callee) || !localNames.has(callee.name)) return;
          if (path.node.arguments.length === 0) return;

          const firstArg = path.node.arguments[0];
          if (!t.isFunctionExpression(firstArg) && !t.isArrowFunctionExpression(firstArg)) {
            return;
          }

          if (!t.isBlockStatement(firstArg.body)) {
            firstArg.body = t.blockStatement([t.returnStatement(firstArg.body)]);
          }

          if (!hasWorkletDirective(firstArg.body)) {
            firstArg.body.directives = firstArg.body.directives ?? [];
            firstArg.body.directives.unshift(t.directive(t.directiveLiteral("worklet")));
          }
        },
        Function(path, state) {
          if (path.getData("zynthWorkletProcessed")) {
            return;
          }

          const body = path.node.body;
          if (!t.isBlockStatement(body)) {
            return;
          }
          if (!hasWorkletDirective(body)) {
            return;
          }

          stripWorkletDirective(body);
          path.setData("zynthWorkletProcessed", true);

          const closureNames = new Set<string>();
          path.traverse({
            Function(inner) {
              if (inner !== path) {
                inner.skip();
              }
            },
            Identifier(idPath) {
              if (!idPath.isReferencedIdentifier()) return;
              const name = idPath.node.name;
              if (name === "arguments") return;
              const binding = path.scope.getBinding(name);
              if (!binding) return;
              if (binding.scope !== path.scope) {
                closureNames.add(name);
              }
            },
          });

          const closureProps = Array.from(closureNames).map((name) =>
            t.objectProperty(
              t.identifier(name),
              t.identifier(name),
              false,
              true
            )
          );
          const closureExpr = t.objectExpression(closureProps);

          const loc = path.node.loc?.start;
          const location = getLocation(state, loc?.line, loc?.column);
          const generatedCode = path.toString();
          const metadata = t.objectExpression([
            t.objectProperty(t.identifier("location"), t.stringLiteral(location)),
            t.objectProperty(t.identifier("code"), t.stringLiteral(generatedCode)),
          ]);

          if (path.isFunctionDeclaration()) {
            const id = path.node.id;
            if (!id) return;
            const assign = t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(id, t.identifier("__zynth_worklet")),
                metadata
              )
            );
            path.insertAfter(assign);
            const assignClosure = t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(id, t.identifier("__zynth_worklet_closure")),
                closureExpr
              )
            );
            path.insertAfter(assignClosure);
            return;
          }

          if (path.isFunctionExpression() || path.isArrowFunctionExpression()) {
            const assignTarget = t.objectExpression([
              t.objectProperty(t.identifier("__zynth_worklet"), metadata),
              t.objectProperty(
                t.identifier("__zynth_worklet_closure"),
                closureExpr
              ),
            ]);
            const wrapped = t.callExpression(
              t.memberExpression(t.identifier("Object"), t.identifier("assign")),
              [path.node, assignTarget]
            );
            path.replaceWith(wrapped);
          }
        },
      },
    };
  };
}
