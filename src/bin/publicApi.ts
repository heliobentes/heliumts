import fs from "fs";
import path from "path";
import ts from "typescript";

const MAX_OUTPUT_BYTES = 16384;
const MAX_LIST_MATCHES = 100;

/** Shared declaration-only reader; no application discovery or implementation imports. */
function publicApiContext(packageRoot: string, entry: unknown) {
    if (Array.isArray(entry)) {
        throw new Error("Specify --from only once.");
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
        exports: Record<string, { types?: string }>;
    };
    const entries = Object.keys(pkg.exports).filter((key) => key === "." || (key.startsWith("./") && key !== "./internal" && !key.includes("*")));
    const key = entry === "." ? "." : `./${entry}`;
    if (typeof entry !== "string" || !entries.includes(key)) {
        throw new Error(`Unknown public entrypoint. Choose --from ${entries.map((value) => (value === "." ? "." : value.slice(2))).join(", ")}.`);
    }
    const declaration = pkg.exports[key].types;
    const dist = path.resolve(packageRoot, "dist") + path.sep;
    const file = declaration ? path.resolve(packageRoot, declaration) : "";
    if (!file.startsWith(dist) || !file.endsWith(".d.ts") || !fs.existsSync(file)) {
        throw new Error(`Installed declarations unavailable for ${key}; use a matching built HeliumTS package.`);
    }
    const program = ts.createProgram([file], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        types: [],
        noLib: true,
        skipLibCheck: true,
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) {
        throw new Error(`Cannot read declaration exports for ${key}.`);
    }
    const exports = checker.getExportsOfModule(moduleSymbol);
    const module = key === "." ? "heliumts" : `heliumts/${key.slice(2)}`;
    const resolve = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
    return { exports, module, resolve, checker, dist };
}

/** Bounded public-name discovery. The filter is a literal substring, not a regular expression. */
export function listPublicApi(packageRoot: string, entry: unknown = "client", match?: unknown) {
    if (match !== undefined && (typeof match !== "string" || !match.trim())) {
        throw new Error("--match requires one non-empty literal name fragment; specify it only once.");
    }
    const { exports, module, resolve } = publicApiContext(packageRoot, entry);
    const fragment = typeof match === "string" ? match.toLowerCase() : "";
    const matches = exports.filter((symbol) => symbol.name.toLowerCase().includes(fragment));
    if (matches.length > MAX_LIST_MATCHES) {
        throw new Error(`More than ${MAX_LIST_MATCHES} public exports match in ${module}; refine --match. No results were truncated.`);
    }
    const symbols = matches
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((symbol) => {
            const flags = resolve(symbol).flags;
            const declarationKind =
                flags & ts.SymbolFlags.Class
                    ? "class"
                    : flags & ts.SymbolFlags.Interface
                      ? "interface"
                      : flags & ts.SymbolFlags.TypeAlias
                        ? "type"
                        : flags & ts.SymbolFlags.Enum
                          ? "enum"
                          : flags & ts.SymbolFlags.Function
                            ? "function"
                            : flags & ts.SymbolFlags.Module
                              ? "namespace"
                              : "value";
            return { name: symbol.name, declarationKind };
        });
    const result = {
        module,
        match: match ?? null,
        symbols,
        count: symbols.length,
        note: "Kinds describe declarations, not runtime availability; some exports are type-only. Use an exact symbol lookup for signatures. Filtering is a case-insensitive literal name substring.",
    };
    if (Buffer.byteLength(JSON.stringify(result, null, 2) + "\n") > MAX_OUTPUT_BYTES) {
        throw new Error(`Public export list exceeds ${MAX_OUTPUT_BYTES} bytes; refine --match. No results were truncated.`);
    }
    return result;
}

/** Read installed declaration exports only; never import application or framework implementations. */
export function inspectPublicApi(packageRoot: string, name: unknown, entry: unknown = "client") {
    if (typeof name !== "string" || !name.trim()) {
        throw new Error("api requires one non-empty public symbol name.");
    }
    const { exports, module, resolve, checker, dist } = publicApiContext(packageRoot, entry);
    const exported = exports.find((symbol) => symbol.name === name);
    if (!exported) {
        throw new Error(`No public export ${name} from ${module}. Use an exact exported name; discover names with api --list --from ${entry}.`);
    }
    const symbol = resolve(exported);
    const nodes = symbol.getDeclarations() ?? [];
    if (!nodes.length || nodes.some((node) => !node.getSourceFile().isDeclarationFile || !node.getSourceFile().fileName.startsWith(dist))) {
        throw new Error(`No local declaration available for ${name} from ${module}.`);
    }
    const related = new Map<string, { publicExports: string[]; symbol?: ts.Symbol }>();
    for (const node of nodes) {
        const visit = (child: ts.Node) => {
            if (ts.isTypeReferenceNode(child)) {
                const target = checker.getSymbolAtLocation(child.typeName);
                if (!target || !(resolve(target).flags & ts.SymbolFlags.TypeParameter)) {
                    related.set(child.typeName.getText(), {
                        symbol: target ? resolve(target) : undefined,
                        publicExports: target
                            ? exports
                                  .filter((item) => item !== exported && resolve(item) === resolve(target))
                                  .map((item) => item.name)
                                  .sort()
                            : [],
                    });
                }
            }
            ts.forEachChild(child, visit);
        };
        visit(node);
    }
    const printer = ts.createPrinter();
    const excerpt = (node: ts.Declaration) => {
        // A variable's parent statement may declare unrelated bindings. Print only this one.
        const text = ts.isVariableDeclaration(node)
            ? printer.printNode(
                  ts.EmitHint.Unspecified,
                  ts.factory.createVariableStatement(
                      [ts.factory.createModifier(ts.SyntaxKind.DeclareKeyword)],
                      ts.factory.createVariableDeclarationList([node], node.parent.flags & ts.NodeFlags.Const ? ts.NodeFlags.Const : ts.NodeFlags.Let)
                  ),
                  node.getSourceFile()
              )
            : node.getFullText().trim();
        return { file: path.relative(packageRoot, node.getSourceFile().fileName).split(path.sep).join("/"), text };
    };
    const declarations = nodes.map(excerpt);
    const result = {
        module,
        name,
        declarations,
        relatedTypes: [...related]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([type, { publicExports, symbol: relatedSymbol }]) => ({
                name: type,
                publicExports,
                // One level makes private return shapes (such as router state) useful
                // without recursively dumping the declaration dependency graph.
                localDeclarations: publicExports.length
                    ? []
                    : (relatedSymbol?.getDeclarations() ?? [])
                          .filter(
                              (node) =>
                                  (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
                                  node.getSourceFile().isDeclarationFile &&
                                  node.getSourceFile().fileName.startsWith(dist)
                          )
                          .map(excerpt),
            })),
        note: "Excerpts retain overloads and generics; they are not standalone code. Query related public exports separately. Unexported local types are shown one level deep, for reference only; remaining references may be local, built-in or external. Import the selected name only from the public module above.",
    };
    if (Buffer.byteLength(JSON.stringify(result, null, 2) + "\n") > MAX_OUTPUT_BYTES) {
        throw new Error(`Declaration output exceeds ${MAX_OUTPUT_BYTES} bytes; read ${declarations[0].file} for ${name}.`);
    }
    return result;
}
