# Scaffold a minimal app

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: None beyond an installed HeliumTS app.

```bash
npm create heliumts-app@latest my-app
cd my-app
npm run dev
```

The default starter has one page, one typed RPC method and plain CSS. Pass `--template examples` for the tasks and streaming demo, or `--tailwind` for Tailwind CSS. If you pass `--skip-install`, run `npm install` before starting the dev server.

Related: [Verify an application](./verify.md).
