# Contributing to HeliumTS

Thank you for your interest in contributing to HeliumTS! We welcome contributions from the community to help make this framework better.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone. We expect all contributors to:

- Be respectful and considerate in communication
- Welcome newcomers and help them get started
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+ (matching Vite 7)
- npm or yarn
- Git
- React 18+
- Vite 7+
- TypeScript knowledge
- Familiarity with React and Vite

### Finding Issues to Work On

1. Check the [issue tracker](https://github.com/heliobentes/heliumts/issues) for open issues
2. Look for issues labeled `good first issue` or `help wanted`
3. Comment on the issue to let others know you're working on it
4. If you want to work on something not listed, open an issue first to discuss it

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/heliumts.git
cd heliumts

# Add the upstream repository
git remote add upstream https://github.com/heliobentes/heliumts.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build && npm pack
```

This compiles TypeScript files to the `dist` directory.

### 4. Test Your Setup

Create a test project to verify your local build:

```bash
# Create a test React + Vite project
npm create vite@latest test-app -- --template react-ts
cd test-app

# Install your local helium build. Change the path and version as needed.
npm install ../helium-0.0.0.tgz

# Test the CLI
npx helium dev
```

## Project Structure

```
heliumts/
├── src/
│   ├── bin/
│   │   └── helium.ts           # CLI entry point
│   ├── client/                 # Client-side exports
│   │   ├── Router.tsx          # Client router implementation
│   │   ├── useCall.ts          # RPC mutation hook
│   │   ├── useFetch.ts         # RPC query hook
│   │   ├── rpcClient.ts        # WebSocket RPC client
│   │   └── cache.ts            # Client-side cache
│   ├── server/                 # Server-side exports
│   │   ├── devServer.ts        # Development server
│   │   ├── prodServer.ts       # Production server
│   │   ├── rpcRegistry.ts      # RPC method registry
│   │   ├── httpRouter.ts       # HTTP request router
│   │   ├── config.ts           # Configuration loader
│   │   ├── middleware.ts       # Middleware system
│   │   └── security.ts         # Rate limiting & security
│   ├── vite/                   # Vite plugin
│   │   ├── heliumPlugin.ts     # Main Vite plugin
│   │   ├── scanner.ts          # Server exports scanner
│   │   ├── ssg.ts              # Static site generation
│   │   └── virtualServerModule.ts  # Virtual module generation
│   ├── runtime/
│   │   └── protocol.ts         # RPC protocol definitions
│   └── utils/
│       ├── logger.ts           # Logging utilities
│       ├── envLoader.ts        # Environment variable loader
│       └── ipExtractor.ts      # Client IP extraction
├── docs/                       # Documentation
├── dist/                       # Build output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Use descriptive branch names:

- `feature/add-middleware-support`
- `fix/router-crash-on-404`
- `docs/update-ssg-guide`
- `refactor/simplify-rpc-protocol`

### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Update tests if applicable
- Update documentation if needed

### 3. Test Your Changes

```bash
# Build the project
npm run build

# Pack the project
npm pack

# Test in a real project
cd ../test-app
npm install file:../heliumts/heliumts-0.0.0.tgz --force
npx helium dev
```

Test various scenarios:

- Development mode (`npx helium dev`)
- Production build (`npx helium build`)
- Production server (`npx helium start`)
- Different configurations in `helium.config.ts`

### 4. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add middleware support for RPC methods"
```

**Commit Message Format:**

- `feat:` or `feature:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions or changes
- `chore:` Build process or tooling changes
- `perf:` Performance improvements

**Examples:**

```
feat: add support for WebSocket compression
fix: resolve race condition in RPC client connection
docs: update routing documentation with examples
refactor: simplify config loading logic
test: add tests for rate limiting
chore: update dependencies
perf: optimize server method scanning
```

## Testing

### Manual Testing

Always test your changes manually in a real project:

1. **Development Server:**

    ```bash
    npx helium dev
    # Test hot reload, RPC calls, routing
    ```

2. **Production Build:**

    ```bash
    npx helium build
    npx helium start
    # Test optimized builds, SSG, config transpilation
    ```

3. **Different Configurations:**
    - Test with different `helium.config.ts` options
    - Test with/without middleware
    - Test with/without SSG pages
    - Test different RPC encoding formats

### Test Checklist

Before submitting a PR, verify:

- [ ] Development server starts without errors
- [ ] Hot reload works correctly
- [ ] RPC methods can be called from client
- [ ] Routing works (static, dynamic, catch-all)
- [ ] Layouts render correctly
- [ ] Production build completes successfully
- [ ] Production server starts and serves pages
- [ ] SSG pages generate correctly (if applicable)
- [ ] Configuration loads properly
- [ ] No TypeScript errors (`npm run build`)
- [ ] Documentation is updated

### Automated Tests

Run the complete checks before submitting changes:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:smoke
```

The suite includes browser-like unit tests and production HTTP/WebSocket tests on temporary local ports. Dependency upgrades should also be checked with `npm audit`.

## Submitting Changes

### 1. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 2. Create a Pull Request

1. Go to the [HeliumTS repository](https://github.com/heliobentes/heliumts)
2. Click "New Pull Request"
3. Select your fork and branch
4. Fill out the PR template:

**Pull Request Template:**

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Performance improvement

## Testing

Describe how you tested your changes

## Checklist

- [ ] Code builds without errors
- [ ] Changes tested in development mode
- [ ] Changes tested in production build
- [ ] Documentation updated (if needed)
- [ ] No breaking changes (or documented)
```

### 3. Review Process

- Maintainers will review your PR
- Address any feedback or requested changes
- Once approved, your PR will be merged

### 4. Keep Your Branch Updated

If the main branch has been updated:

```bash
git fetch upstream
git rebase upstream/main
git push origin feature/your-feature-name --force
```

## Coding Standards

### TypeScript

- Use TypeScript for all code
- Avoid `any` types when possible
- Export types for public APIs
- Use strict type checking

**Example:**

```typescript
// ✅ Good
export interface RpcOptions {
    timeout?: number;
    retries?: number;
}

export async function callRpc(method: string, options: RpcOptions): Promise<unknown> {
    // Implementation
}

// ❌ Avoid
export async function callRpc(method: any, options: any): Promise<any> {
    // Implementation
}
```

### Code Style

- Use 4 spaces for indentation (or respect existing .editorconfig)
- Use semicolons
- Use double quotes for strings (except where single quotes are necessary)
- Use arrow functions for callbacks
- Use async/await over promises chains

**Example:**

```typescript
// ✅ Good
const result = await fetchData();
const items = data.map((item) => item.value);

// ❌ Avoid
fetchData().then((result) => {
    const items = data.map(function (item) {
        return item.value;
    });
});
```

You can use the provided ESLint and Prettier configurations to automatically format your code.

### Naming Conventions

- **Files:** camelCase for utilities, PascalCase for components
    - `rpcClient.ts`, `Router.tsx`, `heliumPlugin.ts`
- **Functions:** camelCase
    - `loadConfig()`, `extractClientIP()`, `defineMethod()`
- **Classes:** PascalCase
    - `RpcClient`, `HttpRouter`
- **Constants:** UPPER_SNAKE_CASE
    - `DEFAULT_PORT`, `MAX_RETRIES`
- **Types/Interfaces:** PascalCase
    - `HeliumConfig`, `RpcOptions`

### Comments

Write comments for:

- Complex algorithms or logic
- Non-obvious behavior
- Public API functions (JSDoc style)
- Important decisions or tradeoffs

**Example:**

```typescript
/**
 * Extract client IP from request, respecting proxy depth configuration.
 *
 * Checks headers in order of reliability:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. True-Client-IP (Cloudflare Enterprise)
 * 3. X-Real-IP (Nginx)
 * 4. X-Forwarded-For (Standard)
 * 5. Direct connection
 *
 * @param req - HTTP request object
 * @param trustProxyDepth - Number of proxy levels to trust
 * @returns Client IP address
 */
export function extractClientIP(req: http.IncomingMessage, trustProxyDepth: number): string {
    // Implementation
}
```

### Error Handling

- Use descriptive error messages
- Include context in errors
- Log errors appropriately
- Handle edge cases

**Example:**

```typescript
// ✅ Good
if (!config.rpc) {
    throw new Error("RPC configuration is missing in helium.config.ts");
}

// ❌ Avoid
if (!config.rpc) {
    throw new Error("Missing config");
}
```

### Logging

- Use the provided logger utility for consistent logging
- Log at appropriate levels (info, warn, error)
  **Example:**

```typescript
import { log } from "../utils/logger";

log("info", "Server started on port 3000");
log("error", "Failed to connect to database", err);
```

## Documentation

### When to Update Documentation

Update documentation when:

- Adding new features
- Changing existing behavior
- Fixing bugs that affect user-facing behavior
- Adding new configuration options
- Changing CLI commands

### Documentation Files

- **README.md** - Main documentation, getting started guide
- **docs/routing.md** - Routing and useRouter hook
- **docs/helium-config.md** - Configuration options
- **docs/ssg.md** - Static site generation
- **docs/context-api.md** - Request context
- **docs/proxy-configuration.md** - Proxy and IP detection
- **docs/production-deployment.md** - Deployment guides
- **docs/route-groups.md** - Route groups and layouts

### Documentation Style

- Use clear, concise language
- Include code examples
- Show both good and bad examples when helpful
- Use headings and lists for organization
- Link to related documentation
- Include troubleshooting sections

### JSDoc Comments

Add JSDoc comments for all public APIs:

````typescript
/**
 * Define a server-side RPC method that can be called from the client.
 *
 * @param handler - Async function that handles the RPC call
 * @returns RPC method that can be called from client
 *
 * @example
 * ```typescript
 * export const getTasks = defineMethod(async (args: { status: string }) => {
 *     return await db.tasks.findMany({ where: { status: args.status } });
 * });
 * ```
 */
export function defineMethod<T extends (...args: any[]) => Promise<any>>(handler: T): T {
    // Implementation
}
````

## Community

### Getting Help

- **GitHub Issues:** Report bugs or request features
- **Discussions:** Ask questions or share ideas
- **Discord:** (Coming soon) Real-time chat with the community

### Reporting Bugs

When reporting bugs, include:

1. **Description:** Clear description of the bug
2. **Steps to Reproduce:** How to reproduce the issue
3. **Expected Behavior:** What you expected to happen
4. **Actual Behavior:** What actually happened
5. **Environment:**
    - Node.js version
    - npm/yarn version
    - HeliumTS version
    - Operating system
6. **Code Sample:** Minimal reproducible example
7. **Error Messages:** Full error messages or stack traces

### Suggesting Features

When suggesting features:

1. **Use Case:** Explain why this feature is needed
2. **Proposed Solution:** How you think it should work
3. **Alternatives:** Other solutions you've considered
4. **Examples:** Show examples from other frameworks (if applicable)

### Asking Questions

Before asking questions:

1. Check the [documentation](./README.md)
2. Search [existing issues](https://github.com/heliobentes/heliumts/issues)
3. Search [discussions](https://github.com/heliobentes/heliumts/discussions)

When asking questions:

- Be specific and clear
- Include relevant code samples
- Explain what you've already tried
- Share your configuration

## AI & Vibe Coding

We welcome contributions generated with the assistance of AI tools, provided that:

1. The contributor reviews and tests the generated code to ensure correctness and quality.
2. The contribution adheres to the project's coding standards and guidelines.

This entire project was initially created with the assistance of AI tools. We believe that AI can be a powerful aid in software development when used responsibly.

## Release Process

(For maintainers)

1. Update `package.json`, `package-lock.json`, `CHANGELOG.md`, and affected documentation. Use the same version for `heliumts` and `create-heliumts-app`, and set both starter templates to depend on that framework release.
2. Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run test:smoke`.
3. Pack the package and validate its tarball in the scaffolder templates, docs site, and example app.
4. Commit the release and create its version tag.
5. Publish the validated tarball with `npm publish <tarball> --access public --tag latest`; verify the registry version and integrity.
6. Update companion lockfiles against the published version, validate their builds, and push release commits/tags.
7. Publish the scaffolder tarball and verify the installed generator creates working apps. Update the existing docs deployment through its configured release process.

## License

By contributing to HeliumTS, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have questions about contributing, feel free to:

- Open a [discussion](https://github.com/heliobentes/heliumts/discussions)
- Open an [issue](https://github.com/heliobentes/heliumts/issues)
- Email: [heliobentes@example.com] (Update with actual contact)

Thank you for contributing to HeliumTS! 🚀
