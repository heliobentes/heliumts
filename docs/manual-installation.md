# Manual Installation

If you prefer to set up your project manually instead of using the scaffolding tool, follow these steps to create a new HeliumTS project.

## 1. Install React + Vite

Create a new Vite project with the React TypeScript template:

```bash
npm create vite@latest my-helium-app -- --template react-ts
cd my-helium-app
```

## 2. Install HeliumTS

Install the HeliumTS package:

```bash
npm install heliumts
```

## 3. Setup Vite Config

Create or update `vite.config.ts` in the project root to include Helium's Vite plugin:

```typescript
import react from '@vitejs/plugin-react';
import helium from 'heliumts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react(), helium()]
});
```

## 4. Delete `main.tsx`

Delete the `src/main.tsx` file created by Vite, as HeliumTS handles the client entry point automatically.

Also, remove its reference from `index.html` if present:

```html
<!-- Remove this from index.html -->
<script type="module" src="/src/main.tsx"></script>
```

## 5. Update `src/App.tsx`

Replace the contents of `src/App.tsx` with the following content:

```tsx
import { type AppShellProps } from "heliumts/client";

export default function App({ Component, pageProps }: AppShellProps) {
    return <Component {...pageProps} />;
}
```

## 6. Create Project Structure

Create the basic directory structure for your application:

```bash
mkdir -p src/pages src/server
```

Create your first page in `src/pages/index.tsx`:

```tsx
import React from "react";

export default function HomePage() {
    return (
        <div>
            <h1>Welcome to HeliumTS</h1>
            <p>Start building your app!</p>
        </div>
    );
}
```

## 7. Start Development Server

You can now start the development server:

```bash
npx helium dev
```

Your app should be running at `http://localhost:5173`.
