import path from "path";
import ts from "typescript";

const factories = new Set(["defineMethod", "defineHTTPRequest", "defineSEOMetadata", "defineWorker", "middleware", "defineMiddleware"]);
export interface DiscoveredExport {
    name: string;
    filePath: string;
    factory: string;
    origin: string;
    location: string;
}

/** All bound identifiers matter for shadowing, even when they are not RPCs. */
function bindingNames(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) {
        return [name.text];
    }
    return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

function declarationExportName(statement: ts.FunctionDeclaration | ts.ClassDeclaration | ts.EnumDeclaration): string | undefined {
    return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name?.text;
}

/** Parse declarations, never import or execute application modules. */
export function discoverExports(files: Map<string, string>): DiscoveredExport[] {
    const modules = new Map([...files].map(([file, source]) => [file, ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)]));
    for (const [file, source] of modules) {
        // The parser records syntax errors without resolving imports or evaluating code.
        const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics;
        if (diagnostics.length) {
            const error = diagnostics[0];
            const position = source.getLineAndCharacterOfPosition(error.start ?? 0);
            throw new Error(`${file}:${position.line + 1}:${position.character + 1}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
        }
    }
    const result: DiscoveredExport[] = [];
    const resolveFile = (from: string, specifier: string) => {
        if (!specifier.startsWith(".")) {
            return undefined;
        }
        const base = path.resolve(path.dirname(from), specifier);
        return [base, ...[".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", "/index.ts", "/index.js"].map((ext) => base + ext), base.replace(/\.[cm]?js$/, ".ts")].find((file) =>
            modules.has(file)
        );
    };
    type Found = { factory: string; origin: string; location: string };
    function resolve(file: string, name: string, exported: boolean, seen = new Set<string>()): Found | undefined {
        const key = `${file}:${exported}:${name}`;
        if (seen.has(key)) {
            return;
        }
        seen = new Set(seen).add(key);
        const source = modules.get(file)!;
        function expression(node: ts.Expression): Found | undefined {
            if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
                return expression(node.expression);
            }
            if (ts.isIdentifier(node)) {
                return resolve(file, node.text, false, seen);
            }
            if (!ts.isCallExpression(node)) {
                return;
            }
            const callee = node.expression;
            let factory: string | undefined;
            if (ts.isIdentifier(callee)) {
                for (const statement of source.statements) {
                    if (
                        !ts.isImportDeclaration(statement) ||
                        !ts.isStringLiteral(statement.moduleSpecifier) ||
                        statement.moduleSpecifier.text !== "heliumts/server" ||
                        statement.importClause?.isTypeOnly
                    ) {
                        continue;
                    }
                    const bindings = statement.importClause?.namedBindings;
                    if (bindings && ts.isNamedImports(bindings)) {
                        const binding = bindings.elements.find((item) => !item.isTypeOnly && item.name.text === callee.text);
                        if (binding) {
                            factory = (binding.propertyName ?? binding.name).text;
                        }
                    }
                }
                // Preserve bare factory declarations used by generated sources, but never
                // mistake an explicitly declared/imported unrelated function for Helium.
                if (
                    !factory &&
                    factories.has(callee.text) &&
                    !source.statements.some(
                        (statement) =>
                            ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
                                statement.name?.text === callee.text) ||
                            (ts.isImportDeclaration(statement) && statement.importClause?.name?.text === callee.text) ||
                            (ts.isImportDeclaration(statement) &&
                                statement.importClause?.namedBindings &&
                                ts.isNamespaceImport(statement.importClause.namedBindings) &&
                                statement.importClause.namedBindings.name.text === callee.text) ||
                            (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => bindingNames(d.name).includes(callee.text))) ||
                            (ts.isImportDeclaration(statement) &&
                                statement.importClause?.namedBindings &&
                                ts.isNamedImports(statement.importClause.namedBindings) &&
                                statement.importClause.namedBindings.elements.some((b) => b.name.text === callee.text))
                    )
                ) {
                    factory = callee.text;
                }
            } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
                const namespace = callee.expression.text;
                if (
                    source.statements.some(
                        (statement) =>
                            ts.isImportDeclaration(statement) &&
                            ts.isStringLiteral(statement.moduleSpecifier) &&
                            statement.moduleSpecifier.text === "heliumts/server" &&
                            !statement.importClause?.isTypeOnly &&
                            statement.importClause?.namedBindings &&
                            ts.isNamespaceImport(statement.importClause.namedBindings) &&
                            statement.importClause.namedBindings.name.text === namespace
                    )
                ) {
                    factory = callee.name.text;
                }
            }
            if (factory && factories.has(factory)) {
                const position = source.getLineAndCharacterOfPosition(node.getStart(source));
                return { factory, origin: `${file}:${node.pos}`, location: `${file}:${position.line + 1}:${position.character + 1}` };
            }
        }
        for (const statement of source.statements) {
            if (
                exported &&
                (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
                declarationExportName(statement) === name &&
                statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
            ) {
                return; // Explicit non-RPC declarations also shadow star exports.
            }
            if (ts.isVariableStatement(statement) && (!exported || statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))) {
                for (const declaration of statement.declarationList.declarations) {
                    if (bindingNames(declaration.name).includes(name)) {
                        return ts.isIdentifier(declaration.name) && declaration.initializer ? expression(declaration.initializer) : undefined;
                    }
                }
            }
            if (exported && name === "default" && ts.isExportAssignment(statement) && !statement.isExportEquals) {
                return expression(statement.expression);
            }
            if (exported && ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
                const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? resolveFile(file, statement.moduleSpecifier.text) : undefined;
                if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                    const binding = statement.exportClause.elements.find((item) => !item.isTypeOnly && item.name.text === name);
                    if (binding) {
                        if (statement.moduleSpecifier && !target) {
                            return;
                        }
                        return resolve(target ?? file, (binding.propertyName ?? binding.name).text, !!target, seen);
                    }
                } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === name) {
                    return; // An explicit namespace export shadows any star export.
                }
            }
            if (!exported && ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
                const target = resolveFile(file, statement.moduleSpecifier.text);
                if (target && statement.importClause?.name?.text === name) {
                    return resolve(target, "default", true, seen);
                }
                const bindings = statement.importClause?.namedBindings;
                if (target && bindings && ts.isNamedImports(bindings)) {
                    const binding = bindings.elements.find((item) => !item.isTypeOnly && item.name.text === name);
                    if (binding) {
                        return resolve(target, (binding.propertyName ?? binding.name).text, true, seen);
                    }
                }
            }
        }
        // ESM explicit exports win regardless of declaration order. Resolve stars only
        // after checking all explicit exports, and omit ambiguous star bindings.
        let candidate: Found | undefined;
        let matched = false;
        if (exported && name !== "default") {
            for (const statement of source.statements) {
                if (
                    !ts.isExportDeclaration(statement) ||
                    statement.isTypeOnly ||
                    statement.exportClause ||
                    !statement.moduleSpecifier ||
                    !ts.isStringLiteral(statement.moduleSpecifier)
                ) {
                    continue;
                }
                const target = resolveFile(file, statement.moduleSpecifier.text);
                if (!target || !names(target).has(name)) {
                    continue;
                }
                const found = resolve(target, name, true, seen);
                if (matched && (!found || !candidate || found.origin !== candidate.origin)) {
                    return;
                }
                matched = true;
                candidate = found;
            }
        }
        return candidate;
    }
    function names(file: string, seen = new Set<string>()): Set<string> {
        if (seen.has(file)) {
            return new Set();
        }
        seen = new Set(seen).add(file);
        const found = new Set<string>();
        for (const statement of modules.get(file)!.statements) {
            if (ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
                for (const d of statement.declarationList.declarations) {
                    for (const name of bindingNames(d.name)) {
                        found.add(name);
                    }
                }
            } else if (
                (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
                statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
            ) {
                const name = declarationExportName(statement);
                if (name) {
                    found.add(name);
                }
            } else if (ts.isExportAssignment(statement)) {
                found.add("default");
            } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
                if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                    for (const binding of statement.exportClause.elements) {
                        if (!binding.isTypeOnly) {
                            found.add(binding.name.text);
                        }
                    }
                } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
                    found.add(statement.exportClause.name.text);
                } else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
                    const target = resolveFile(file, statement.moduleSpecifier.text);
                    if (target) {
                        for (const name of names(target, seen)) {
                            if (name !== "default") {
                                found.add(name);
                            }
                        }
                    }
                }
            }
        }
        return found;
    }
    for (const file of modules.keys()) {
        for (const name of names(file)) {
            const found = resolve(file, name, true);
            if (found) {
                result.push({ name, filePath: file, ...found });
            }
        }
    }
    return result;
}
