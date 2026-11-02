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
