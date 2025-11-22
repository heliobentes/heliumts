# HeliumJS — Copilot Instructions

## What HeliumJS Is

HeliumJS is a file-based RPC framework.
Client code imports server functions directly (through virtual modules) and calls them over a persistent WebSocket connection.
There is no REST, no fetch/axios, no API routes, and no Next.js-style routing.

Server methods live in:

```
src/server/*/*.ts
```

and are defined using:

```
export const getTasks = defineMethod(async (args, ctx) => { ... });
```

The framework scans these files, generates virtual modules, and automatically starts the RPC server during development.

---

## Virtual Modules

The Vite plugin generates:

### 1. Client stub module (imported by user code)

```
import { getTasks } from "helium/server";
```

This module only provides metadata stubs (method ids), not actual server code.

### 2. Server manifest (used internally by the RPC server)

```
import { serverMethods } from "helium/__serverManifest";
```

The manifest maps method ids to actual server handlers.

---

## Client Runtime

HeliumJS exposes two hooks from "helium/client":

### `useFetch(method, args)`

- Automatically calls a remote method
- Re-runs when args change
- Caches results
- Used for reading/querying data

### `useCall(method, options?)`

- Manually triggers a remote call
- Used for create/update/delete operations
- Supports cache invalidation

Both hooks communicate over the WebSocket RPC layer.

---

## RPC Protocol

Communication uses a simple RPC message format over WebSocket:

Request:
`{ id, method, args }`

Response (success):
`{ id, ok: true, result }`

Response (error):
`{ id, ok: false, error }`

No HTTP is used for application data.

---

## Peer Dependency Rules (Critical)

HeliumJS exports React hooks, so React must be a peer dependency, not bundled.

Required in helium/package.json:

```
"peerDependencies": {
"react": "^18",
"react-dom": "^18"
}
```

React must NOT appear in "dependencies".
This prevents "Invalid hook call" errors caused by duplicate React instances.

---

## What Copilot Should Do

- Treat defineMethod() as the only way to create server RPC functions.
- Assume server files live under src/server/\*\*.
- Suggest imports from "helium/server" for client-side usage.
- Generate code consistent with RPC-over-WebSocket, not REST.
- Keep internal modules small, focused, and TypeScript-first.
- Maintain clear separation between client runtime, server runtime, protocol, and Vite plugin logic.
- Prefer minimal abstractions and simple RPC primitives.

---

## What Copilot Should Not Do

- Do not generate REST routes, fetch calls, axios, or Express routers.
- Do not propose Next.js patterns or React Server Components.
- Do not import server files directly into client code.
- Do not bundle React inside the HeliumJS package.
- Do not introduce overly complex RPC or transport mechanisms.

---

## HeliumJS Philosophy

Write a server function.
Import it on the client.
Call it like a normal function.
HeliumJS takes care of everything else.

Simple, file-based, strongly typed, and WebSocket-native.

## While generating code

- Do not use `any` type.
- If you need to run commands on the terminal, use an existing terminal instead of creating a new one.

## Running the APP
- Do not generate code to run the app. Ask the user to run the app and check for terminal output if needed.
