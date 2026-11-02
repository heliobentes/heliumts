import { act } from "@testing-library/react";
import React from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/routerManifest", () => ({ buildRoutes: vi.fn() }));
vi.mock("../../src/client/rpcClient", () => ({ rpcCall: vi.fn(async () => ({ data: null })) }));
const environment = vi.hoisted(() => ({ development: false }));
vi.mock("../../src/client/env", () => ({ isDevEnvironment: () => environment.development }));

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
    vi.resetModules();
    environment.development = false;
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => ({ ssr: false, props: null }) }))
    );
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    delete (window as any).__HELIUM_SSR_DATA__;
    delete (window as any).__heliumCurrentLocation;
    delete (window as any).__heliumLocationListeners;
    delete (window as any).__heliumRouterEmitter;
    delete (window as any).__heliumLocationListenerSetup;
    vi.unstubAllGlobals();
});

async function fixture() {
    const router = await import("../../src/client/Router");
    const { buildRoutes } = await import("../../src/client/routerManifest");
    function Page(input: unknown) {
        const props = input as Record<string, unknown>;
        const location = router.useRouter();
        return (
            <article>
                <h1>{location.path}</h1>
                <p>{location.searchParams.get("q") ?? "none"}</p>
                <b>{String(props.label ?? "empty")}</b>
            </article>
        );
    }
    vi.mocked(buildRoutes).mockReturnValue({
        routes: ["/", "/docs/guide", "/profile"].map((pathPattern) => ({
            pathPattern,
            matcher: (path: string) => (path.replace(/\/$/, "") === pathPattern.replace(/\/$/, "") ? { params: {} } : null),
            Component: Page,
            LazyComponent: React.lazy(async () => ({ default: Page })),
            layouts: [],
            preload: async () => ({ default: Page }),
        })),
    });
    const serverMarkup = (path: string, search: string, label = "empty") =>
        renderToString(
            <router.RouterContext.Provider
                value={{
                    path,
                    searchParams: new URLSearchParams(search),
                    params: {},
                    push: () => {},
                    replace: () => {},
                    on: () => () => {},
                    status: 200,
                    isNavigating: false,
                    isPending: false,
                }}
            >
                {React.createElement<{ label: string }>(Page, { label })}
            </router.RouterContext.Provider>
        );
    return { ...router, serverMarkup };
}

describe("router hydration", () => {
    it("hydrates a non-root static page using its canonical path and server-empty query", async () => {
        window.history.replaceState({}, "", "/docs/guide/?q=browser");
        container.setAttribute("data-ssg-page", "/docs/guide");
        const { AppRouter, serverMarkup } = await fixture();
        container.innerHTML = serverMarkup("/docs/guide", "");
        const article = container.querySelector("article");
        const onRecoverableError = vi.fn();
        await act(async () => {
            root = hydrateRoot(container, <AppRouter />, { onRecoverableError });
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.querySelector("article")).toBe(article);
        expect(container.querySelector("p")?.textContent).toBe("browser");
    });

    it.each(["?q=hello%20world", undefined])("hydrates SSR bootstrap query and props with search=%s", async (search) => {
        window.history.replaceState({}, "", "/profile?q=hello%20world");
        (window as any).__HELIUM_SSR_DATA__ = { path: "/profile", ...(search === undefined ? {} : { search }), props: { label: "server props" } };
        const { AppRouter, serverMarkup } = await fixture();
        container.innerHTML = serverMarkup("/profile", "?q=hello%20world", "server props");
        const article = container.querySelector("article");
        const onRecoverableError = vi.fn();
        await act(async () => {
            root = hydrateRoot(container, <AppRouter />, { onRecoverableError });
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.querySelector("article")).toBe(article);
        expect(container.querySelector("p")?.textContent).toBe("hello world");
        expect(container.querySelector("b")?.textContent).toBe("server props");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("uses the live pathname and query for client-only rendering", async () => {
        window.history.replaceState({}, "", "/docs/guide?q=client");
        const { AppRouter } = await fixture();
        await act(async () => {
            root = createRoot(container);
            root.render(<AppRouter />);
        });
        expect(container.querySelector("h1")?.textContent).toBe("/docs/guide");
        expect(container.querySelector("p")?.textContent).toBe("client");
    });

    it("uses the serialized server query during development hydration before live URL updates", async () => {
        environment.development = true;
        window.history.replaceState({}, "", "/profile?q=browser");
        (window as any).__HELIUM_SSR_DATA__ = { path: "/profile", search: "?q=server", props: {} };
        const { AppRouter, serverMarkup } = await fixture();
        container.innerHTML = serverMarkup("/profile", "?q=server");
        const article = container.querySelector("article");
        const onRecoverableError = vi.fn();
        await act(async () => {
            root = hydrateRoot(container, <AppRouter />, { onRecoverableError });
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(container.querySelector("article")).toBe(article);
        expect(container.querySelector("p")?.textContent).toBe("browser");
    });

    it("keeps a safe snapshot fallback outside the browser", async () => {
        const { AppRouter } = await fixture();
        const browserWindow = window;
        vi.stubGlobal("window", undefined);
        try {
            expect(renderToString(<AppRouter />)).toContain("Not found");
        } finally {
            vi.stubGlobal("window", browserWindow);
        }
    });
});
