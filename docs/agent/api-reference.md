# Find installed public API types

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md)

Use public imports from heliumts/client and heliumts/server. Look up one exact exported symbol in the installed package without loading application modules:

```bash
npx helium api useCall --json
npx helium api useRouter --from client --json
npx helium api defineMethod --from server --json
npx helium api UseCallOptions --from client --json
```

If you do not know a symbol name, discover public names first:

```bash
npx helium api --list --from client --match router --json
npx helium api --list --from server --match method --json
```

Then look up one returned name. --match requires --list and matches a case-insensitive literal name fragment, not a regular expression. A symbol lookup and --list cannot be combined. Listings are sorted, include public aliases and type exports, and report an empty array when nothing matches. Declaration kinds do not imply runtime availability: an export may be type-only. More than 100 matches or 16 KiB of output fails with a request to narrow the filter; results are never silently truncated.

The default entrypoint is client. The result retains overloads, generics and documentation comments, with declaration source paths and related public type names for follow-up queries. Unexported local type shapes are included one level deep for reference, not as import suggestions. Other local, built-in and external references may remain; excerpts are not standalone code. The public module and selected name identify the supported import, even when the declaration uses a different internal alias. Output is capped at 16 KiB; missing, private or oversized lookups fail explicitly. This tool reads this installed framework's declarations, not application-generated RPC methods (use inspect --rpc for those).

If needed, open only the relevant declaration in the installed package:

- Client exports: node_modules/heliumts/dist/client/index.d.ts.
- Read and mutation hooks: node_modules/heliumts/dist/client/useFetch.d.ts and node_modules/heliumts/dist/client/useCall.d.ts.
- Router state and navigation: node_modules/heliumts/dist/client/Router.d.ts.
- Server exports: node_modules/heliumts/dist/server/index.d.ts.
- Request context and method options: node_modules/heliumts/dist/server/context.d.ts and node_modules/heliumts/dist/server/defineMethod.d.ts.

For a symbol search, restrict output to declarations:

```bash
rg -n -g '*.d.ts' 'useRouter|useCall' node_modules/heliumts/dist/client
```

Avoid recursively searching generated JavaScript or source maps for API signatures; those files can produce very large tool outputs.

These are files to read, not application deep-import paths. There is no dist/client/hooks directory. Longer docs linked on the source repository are not all shipped in the npm package; use this task index and the installed declarations first. Check the installed package version before relying on external examples.

Related: [Use request context safely](./request-context.md), [Navigate with file routes](./routing.md).
