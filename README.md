[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![GitHub Issues](https://img.shields.io/github/issues/heliobentes/heliumjs)](https://github.com/heliobentes/heliumjs/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/heliobentes/heliumjs)](https://github.com/heliobentes/heliumjs/pulls)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)

# HeliumJS

HeliumJS is a blazing fast 🚀 and opinionated full-stack React + Vite framework designed for simplicity and type safety. It provides seamless RPC communication and file-based routing.

## Table of Contents

1. [Getting Started](#1-getting-started)
   - [Installation](#11-installation)
   - [Running the Development Server](#12-running-the-development-server)
   - [Building for Production](#13-building-for-production)
   - [Starting the Production Server](#14-starting-the-production-server)
2. [Project Structure](#2-project-structure)
3. [Core Concepts](#3-core-concepts)
   - [RPC (Remote Procedure Calls)](#31-rpc-remote-procedure-calls)
   - [Routing](#32-routing)
   - [Custom HTTP Handlers](#33-custom-http-handlers)
   - [Middleware](#34-middleware)
   - [Configuration](#35-heliumconfigts)
   - [Static Site Generation (SSG)](#36-static-site-generation-ssg)
4. [CLI Reference](#4-cli-reference)
5. [More Documentation](#5-more-documentation)
6. [Contributing](#6-contributing)
7. [License](#7-license)

## 1. Getting Started

### 1.1. Installation

An installation script is coming soon! Meanwhile, follow these steps to set up a new HeliumJS project.

#### 1.1.1. Install React + Vite

```bash
npm create vite@latest my-helium-app -- --template react-ts
```
#### 1.1.2. Install HeliumJS

```bash
npm install github:heliobentes/heliumjs
```
*NPM package is coming soon!*

#### 1.1.3. Setup Vite Config
Create or update `vite.config.ts` in the project root to include Helium's Vite plugin:

```typescript
import react from '@vitejs/plugin-react';
import helium from 'helium/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), helium()]
});
```

#### 1.1.4. Delete **main.tsx**
Delete the `src/main.tsx` file created by Vite, as HeliumJS handles the client entry point automatically.
Also, remove its reference from `index.html` if present.
```html
<!-- Remove this from index.html -->
<script type="module" src="/src/main.tsx"></script>
```

#### 1.1.5. Update `src/App.tsx`
Replace the contents of `src/App.tsx` with the following content:
```tsx
import { type AppShellProps } from "helium/client";

export default function App({ Component, pageProps }: AppShellProps) {
    return <Component {...pageProps} />;
}
```

### 1.2. Running the Development Server

```bash
npx helium dev
```
### 1.3. Building for Production

```bash
npx helium build
```
### 1.4. Starting the Production Server

```bash
npx helium start
```

Check the working Example APP at: [https://github.com/heliobentes/heliumjs-example-app](https://github.com/heliobentes/heliumjs-example-app)

## 2. Project Structure

A typical HeliumJS project looks like this:

```
src/
  pages/             # Client-side pages (Next.js pages router style)
    index.tsx
    [id].tsx         # Dynamic routes
    [...slug].tsx    # Catch-all routes
    _layout.tsx      # Root layout
    (protected)/     # Route group (e.g., for auth)
      dashboard.tsx
  server/            # Server-side logic
    tasks.ts         # RPC methods for tasks
    auth.ts          # Auth-related methods
    webhooks.ts      # Webhook HTTP handlers
    _middleware.ts   # Server middleware
  components/        # React components
  types/             # Shared types
helium.config.ts     # Helium configuration
package.json         # NPM package file
vite.config.ts       # Vite configuration
```

## 3. Core Concepts

Using HeliumJS makes it easy to build full-stack applications with minimal boilerplate. It removes the need for separate API routes and REST endpoints by enabling direct RPC calls from the client to server methods using websocket.

No more `Axios` or `fetch` calls! Just define your server methods and call them directly from your React components with full type safety.

### 3.1. RPC (Remote Procedure Calls)

Define server-side functions using `defineMethod` and call them from the client using `useCall` or `useFetch`.

**Server (`src/server/tasks.ts`):**

```typescript
import { defineMethod } from "helium/server";

// Getting tasks
export const getTasks = defineMethod(async (args: { status: string }) => {
    // Add your own database logic here
    return [{ id: 1, name: "Task 1", status: args.status }];
});

// Creating a new task
export const createTask = defineMethod(async (args: { name: string }) => {
    // Add your own create task logic
    return { id: 2, name: args.name };
});
```

**Client (`src/pages/tasks.tsx`):**

```tsx
import { useFetch, useCall } from "helium/client";
import { getTasks, createTask } from "helium/server";

export default function TasksPage() {
    // Fetch data (auto-runs on mount)
    // Data is typed based on server method return type
    const { data, isLoading } = useFetch(getTasks, { status: "open" });

    // Mutation (callable function)
    // The call function is typed based on server method args and return type
    const { call: add, isCalling } = useCall(createTask, {
        invalidate: [getTasks] // Auto-refresh getTasks after success everywhere it's used
    });

    return (
        <div>
            <button onClick={() => add({ name: "New Task" })}>
                {isCalling ? "Adding..." : "Add Task"}
            </button>
            {data?.map(task => <div key={task.id}>{task.name}</div>)}
        </div>
    );
}
```

### 3.2. Routing

Helium uses file-based routing in the `src/pages` directory similar to
[**Next.js Pages Router**](https://nextjs.org/docs/pages).

-   `src/pages/index.tsx` -> `/`
-   `src/pages/about.tsx` -> `/about`
-   `src/pages/users/[id].tsx` -> `/users/:id` (dynamic routes)
-   `src/pages/_layout.tsx` -> Wraps all pages
-   `src/pages/(protected)/dashboard.tsx` -> `/dashboard` (route group) 
-   `src/pages/[...slug].tsx` -> Catch-all route

**Link Component:**

Helium provides a `Link` component for client-side navigation:

```tsx
import { Link } from "helium/client";

<Link href="/about">Go to About</Link>
```

**useRouter Hook:**

Access routing information and navigation methods:

```tsx
import { useRouter } from "helium/client";

function MyComponent() {
    const router = useRouter();
    
    // Access current route
    console.log(router.path);           // "/users/123"
    console.log(router.params.id);      // "123"
    console.log(router.searchParams);   // URLSearchParams
    console.log(router.status);         // 200 | 404
    
    // Navigate programmatically
    router.push("/dashboard");
    router.replace("/login");
    
    // Listen to route changes
    router.on("navigation", (event) => {
        console.log(`Navigated to ${event.to}`);
    });
}
```

See [Routing Documentation](./docs/routing.md) for detailed information including dynamic routes, layouts, and navigation.

### 3.3. Custom HTTP Handlers

For cases when you need to listen to webhooks or create REST endpoints, use `defineHTTPRequest`.

Useful for integrating with third-party services like Stripe, GitHub, and Auth clients.

#### 3.3.1. Stripe Webhook Example
**Server (`src/server/webhooks.ts`):**

```typescript
import { defineHTTPRequest } from "helium/server";

export const stripeWebhook = defineHTTPRequest("POST", "/webhooks/stripe", async (req, ctx) => {
    const body = await req.json();
    // Handle webhook
    return { received: true };
});
```
#### 3.3.2. Better Auth Example
**Server (`src/server/auth.ts`):**

```typescript
import { defineHTTPRequest } from "helium/server";

export const authHandler = defineHTTPRequest("ALL", "/auth/:provider", async (req, ctx) => {
    // Call the better-auth handler directly
    return auth.handler(await req.toWebRequest());
});
``` 
***`toWebRequest()`** converts Helium's `Request` to a standard web `Request` object.

### 3.4. Middleware

You can define a middleware to intercept requests to the server.

**Server (`src/server/_middleware.ts`):**

```typescript
import { middleware } from "helium/server";

export default middleware(async (ctx, next) => {
    console.log("Request received");
    // Add your database connection or auth logic here
    return next();
});
```

### 3.5. helium.config.ts
Helium's configuration file allows you to customize server settings including RPC encoding, compression, security, and proxy configuration.

```typescript
import type { HeliumConfig } from "helium/server";

const config: HeliumConfig = {
    trustProxyDepth: 1,  // Trust 1 proxy level (e.g., Vercel)
    rpc: {
        encoding: "msgpack",  // or "json"
        compression: {
            enabled: true,
            threshold: 1024,
        },
        security: {
            maxConnectionsPerIP: 10,
            maxMessagesPerWindow: 100,
            rateLimitWindowMs: 60000,
            tokenValidityMs: 30000,
        },
    },
};

export default config;
``` 
See [Configuration Documentation](./docs/helium-config.md) for detailed options.

### 3.6 Static Site Generation (SSG)
HeliumJS supports Static Site Generation (SSG) through pre-rendering pages at build time.

Add a `"use ssg";` directive at the top of your page component to enable SSG:

**SSG page: (`src/pages/about.tsx`)**
```tsx
"use ssg";

import React from "react";

export default function AboutPage() {
    return (
        <div>
            <h1>About Us</h1>
            <p>This page is statically generated at build time.</p>
        </div>
    );
}
```

During build, Helium validates SSG pages and generates optimized static HTML files.

See [SSG Documentation](./docs/ssg.md) for detailed information including limitations, hybrid rendering, and best practices.

## 4.CLI Reference

-   `helium dev`: Starts Vite in development mode.
-   `helium build`:
    1.  Builds the client using Vite.
    2.  Scans `src/server` for exports.
    3.  Bundles the server using esbuild.
    4.  Transpiles `helium.config.ts` to `dist/helium.config.js` (if present).
-   `helium start`: Runs the bundled server (`dist/server.js`).

## 5. More Documentation

### Core Features
-   [Routing & useRouter](./docs/routing.md) - File-based routing, dynamic routes, navigation, and the useRouter hook
-   [Configuration](./docs/helium-config.md) - Configure RPC encoding, compression, security, and proxy settings
-   [Static Site Generation](./docs/ssg.md) - Pre-render pages at build time for better performance
-   [Route Groups](./docs/route-groups.md) - Organize routes with shared layouts without affecting URLs

### Deployment & Advanced
-   [Context API](./docs/context-api.md) - Access request metadata including client IPs and headers
-   [Proxy Configuration](./docs/proxy-configuration.md) - Configure IP detection for rate limiting behind proxies
-   [HTTP Handlers & Webhooks](./docs/http-handlers.md) - Create custom HTTP endpoints for webhooks and REST APIs
-   [Production Deployment](./docs/production-deployment.md) - Deploy to production platforms (Digital Ocean, Docker, etc.)

## 6. Contributing

Contributions are welcome! Please read the [contributing guide](./CONTRIBUTING.md) for details.

## 7. License
This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.