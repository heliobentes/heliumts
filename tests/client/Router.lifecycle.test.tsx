import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppRouter, Link } from "../../src/client/Router";
import { buildRoutes } from "../../src/client/routerManifest";

vi.mock("../../src/client/routerManifest", () => ({ buildRoutes: vi.fn() }));
vi.mock("../../src/client/rpcClient", () => ({
    rpcCall: vi.fn(async () => ({ data: null })),
}));

function CounterPage(input: unknown) {
    const props = input as Record<string, unknown>;
    const [count, setCount] = useState(0);
    return (
        <>
            <button onClick={() => setCount((value) => value + 1)}>Count {count}</button>
            <span>{String(props.label ?? "empty")}</span>
            <Link href="/other">Other</Link>
        </>
    );
}

function CounterLayout({ children }: { children: React.ReactNode }) {
    const [count, setCount] = useState(0);
    return (
        <>
            <button onClick={() => setCount((value) => value + 1)}>Layout count {count}</button>
            {children}
        </>
    );
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function propsResponse(label: string): Response {
    return { ok: true, json: async () => ({ ssr: true, props: { label } }) } as Response;
}

describe("router page lifecycle", () => {
    beforeEach(() => {
        window.history.replaceState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.scrollTo = vi.fn();
        vi.mocked(buildRoutes).mockReturnValue({
            routes: ["/", "/other"].map((pathPattern) => ({
                pathPattern,
                render: "ssr",
                matcher: (path: string) => (path === pathPattern ? { params: {} } : null),
                Component: CounterPage,
                LazyComponent: React.lazy(async () => ({ default: CounterPage })),
                layouts: [CounterLayout],
                preload: async () => ({ default: CounterPage }),
            })),
        });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("preserves page state when asynchronous page props arrive", async () => {
        const response = deferredResponse();
        const fetchMock = vi.fn(() => response.promise);
        vi.stubGlobal("fetch", fetchMock);
        render(<AppRouter />);
        fireEvent.click(screen.getByText("Count 0"));
        expect(screen.getByText("Count 1")).toBeDefined();
        await act(async () => response.resolve(propsResponse("loaded")));
        expect(screen.getByText("loaded")).toBeDefined();
        expect(screen.getByText("Count 1")).toBeDefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not pass the previous route's SSR props to the next page", async () => {
        const nextResponse = deferredResponse();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(propsResponse("first route")).mockReturnValueOnce(nextResponse.promise));
        render(<AppRouter />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText("first route")).toBeDefined();
        fireEvent.click(screen.getByText("Other"));
        expect(screen.queryByText("first route")).toBeNull();
        expect(screen.getByText("empty")).toBeDefined();
        await act(async () => nextResponse.resolve(propsResponse("second route")));
        expect(screen.getByText("second route")).toBeDefined();
    });

    it("uses the SPA page for /products/new on a direct load and after client navigation", async () => {
        function NewProduct() {
            return (
                <>
                    <h1>New product</h1>
                    <Link href="/products/42">View product</Link>
                </>
            );
        }

        function ProductDetail(input: unknown) {
            const { label } = input as { label?: string };
            return (
                <>
                    <h1>{label ?? "Product detail"}</h1>
                    <Link href="/products/new">Add product</Link>
                </>
            );
        }

        vi.mocked(buildRoutes).mockReturnValue({
            routes: [
                {
                    pathPattern: "/products/new",
                    render: "spa",
                    matcher: (path) => (path === "/products/new" ? { params: {} } : null),
                    Component: NewProduct,
                    LazyComponent: React.lazy(async () => ({ default: NewProduct })),
                    layouts: [],
                    preload: async () => ({ default: NewProduct }),
                },
                {
                    pathPattern: "/products/:id",
                    render: "ssr",
                    matcher: (path) => {
                        const id = /^\/products\/([^/]+)$/.exec(path)?.[1];
                        return id ? { params: { id } } : null;
                    },
                    Component: ProductDetail,
                    LazyComponent: React.lazy(async () => ({ default: ProductDetail })),
                    layouts: [],
                    preload: async () => ({ default: ProductDetail }),
                },
            ],
        });
        window.history.replaceState({}, "", "/products/new");
        window.dispatchEvent(new PopStateEvent("popstate"));
        const fetchMock = vi.fn(async () => propsResponse("SSR product:42"));
        vi.stubGlobal("fetch", fetchMock);

        render(<AppRouter />);
        expect(await screen.findByRole("heading", { name: "New product" })).toBeDefined();
        expect(fetchMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("link", { name: "View product" }));
        expect(await screen.findByRole("heading", { name: "SSR product:42" })).toBeDefined();
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/__helium__/page-props?path=%2Fproducts%2F42", expect.objectContaining({ method: "GET" }));
        fetchMock.mockClear();

        fireEvent.click(screen.getByRole("link", { name: "Add product" }));
        expect(await screen.findByRole("heading", { name: "New product" })).toBeDefined();
        expect(window.location.pathname).toBe("/products/new");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("preserves a shared layout's state when navigating between pages", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => propsResponse("loaded"))
        );
        render(<AppRouter />);
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.click(screen.getByText("Layout count 0"));
        fireEvent.click(screen.getByText("Other"));
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText("Layout count 1")).toBeDefined();
    });
});
