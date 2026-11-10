import React from "react";
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerClientAdapter, generateServerClientModule, generateServerPrefetchModule, generateServerTransitionsModule } from "../../src/vite/serverClientAdapter";
import * as rpcClient from "../../src/client/rpcClient";
import { useCall } from "../../src/client/useCall";
import { useFetch } from "../../src/client/useFetch";
import { useStreaming } from "../../src/client/useStreaming";

import { methodReference } from "../client/methodReference";

const method = methodReference<unknown, string>("fixture/read");
const streamMethod = methodReference<unknown, AsyncIterable<string>>("fixture/stream");

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("server client adapter", () => {
    it.each(["ssr", "ssg"] as const)("keeps %s hook return contracts in sync with browser hooks", (mode) => {
        const adapter = createServerClientAdapter(React, mode);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        function Probe() {
            expect(Object.keys(adapter.useCall()).sort()).toEqual(Object.keys(useCall(method)).sort());
            expect(Object.keys(adapter.useFetch()).sort()).toEqual(Object.keys(useFetch(method, undefined, { enabled: false })).sort());
            expect(Object.keys(adapter.useStreaming()).sort()).toEqual(Object.keys(useStreaming(streamMethod)).sort());
            expect(adapter.useCall()).toMatchObject({ data: undefined, stats: null, error: null, isCalling: false });
            expect(adapter.useFetch()).toMatchObject({ data: undefined, stats: null, error: null, isLoading: true });
            return null;
        }
        renderToString(<Probe />);
    });

    it.each(["ssr", "ssg"] as const)("handles %s submission attempts without pretending a server mutation succeeded", async (mode) => {
        const adapter = createServerClientAdapter(React, mode);
        const result = await adapter.useCall().submit();
        expect(result.status).toBe("error");
        if (result.status === "error") {
            expect(result.error.message).toContain("only available in the browser");
        }
    });

    it("reads SSR snapshots at render time instead of capturing the first request", () => {
        const adapter = createServerClientAdapter(React, "ssr");
        vi.stubGlobal("__HELIUM_SSR_ROUTER__", { path: "/a", params: { id: "a" }, search: "q=one" });
        expect(adapter.useRouter().path).toBe("/a");
        vi.stubGlobal("__HELIUM_SSR_ROUTER__", { path: "/b", params: { id: ["b"] }, search: "q=two" });
        expect(adapter.useRouter().searchParams.get("q")).toBe("two");
        expect(adapter.useRouter().params).toEqual({ id: ["b"] });
    });

    it("renders SSG children with provider context and preserves link markup", () => {
        const adapter = createServerClientAdapter(React, "ssg");
        const value = {
            path: "/article",
            params: {},
            searchParams: new URLSearchParams(),
            push() {},
            replace() {},
            on: () => () => {},
            status: 200 as const,
            isNavigating: false,
            isPending: false,
        };
        function Page() {
            return (
                <adapter.Link href={adapter.useRouter().path} prefetch className="link">
                    Article
                </adapter.Link>
            );
        }
        const html = renderToString(
            <adapter.RouterContext.Provider value={value}>
                <adapter.AppRouter>
                    <Page />
                </adapter.AppRouter>
            </adapter.RouterContext.Provider>
        );
        expect(html).toBe('<a href="/article" class="link">Article</a>');
        expect(renderToString(<>{createServerClientAdapter(React, "ssr").AppRouter({ children: "hidden" })}</>)).toBe("");
    });

    it.each(["ssr", "ssg"] as const)("emits standalone executable %s JavaScript with matching exports", (mode) => {
        const source = generateServerClientModule(mode);
        const names = source
            .match(/export const \{([\s\S]*?)\} = adapter;/)![1]
            .split(",")
            .map((name) => name.trim());
        // Execute the generated module body without a bundler, catching accidental
        // closures, TypeScript syntax, or transform helper dependencies.
        const body = source
            .replace("import React from 'react';", "")
            .replace(/export const \{[\s\S]*?\} = adapter;/, `return { ${names.map((name) => `${name}: adapter.${name}`).join(",")} };`);
        const generated = new Function("React", body)(React) as ReturnType<typeof createServerClientAdapter>;
        expect(generated.isSSR()).toBe(true);
        expect(generated.useCall().data).toBeUndefined();
        expect(generated.useCall().stats).toBeNull();
        expect(names).toEqual(
            expect.arrayContaining([
                "AppRouter",
                "Link",
                "Redirect",
                "RouterContext",
                "useRouter",
                "useCall",
                "useFetch",
                "useStreaming",
                "callMethod",
                "streamRpc",
                "RpcError",
                "isSSR",
                "getPublicEnv",
                "getPublicEnvValue",
                "isDevEnvironment",
            ])
        );
        expect(new generated.RpcError("failure")).toMatchObject({ name: "RpcError", message: "failure", stats: null });
    });

    it("hydrates the initial mutation state without changing rendered markup", async () => {
        const adapter = createServerClientAdapter(React, "ssr");
        function ServerPage() {
            const { data, stats, isCalling } = adapter.useCall();
            return <p>{data === undefined && stats === null && !isCalling ? "Ready" : "Changed"}</p>;
        }
        function BrowserPage() {
            const { data, stats, isCalling } = useCall(method);
            return <p>{data === undefined && stats === null && !isCalling ? "Ready" : "Changed"}</p>;
        }
        const container = document.createElement("div");
        container.innerHTML = renderToString(<ServerPage />);
        const recoverable = vi.fn();
        let root: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(container, <BrowserPage />, { onRecoverableError: recoverable });
        });
        expect(container.innerHTML).toBe("<p>Ready</p>");
        expect(recoverable).not.toHaveBeenCalled();
        await act(async () => {
            root.unmount();
        });
    });

    it.each([
        ["ssr", undefined],
        ["ssr", true],
        ["ssr", false],
        ["ssg", undefined],
        ["ssg", true],
        ["ssg", false],
    ] as const)("hydrates fresh %s fetch state with enabled=%s", async (mode, enabled) => {
        const adapter = createServerClientAdapter(React, mode);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const read = { ...method, __id: `fixture/hydrate/${mode}/${String(enabled)}` };
        const options = enabled === undefined ? undefined : { enabled };
        let resolve!: (result: rpcClient.RpcResult<unknown>) => void;
        const pending = new Promise<rpcClient.RpcResult<unknown>>((done) => {
            resolve = done;
        });
        const rpc = vi.spyOn(rpcClient, "rpcCall").mockReturnValue(pending);
        function ServerPage() {
            const { data, isLoading } = adapter.useFetch(read, undefined, options);
            return <p>{isLoading ? "Loading" : data === undefined ? "Idle" : "Loaded"}</p>;
        }
        function BrowserPage() {
            const { data, isLoading } = useFetch(read, undefined, options);
            return <p>{isLoading ? "Loading" : data === undefined ? "Idle" : "Loaded"}</p>;
        }
        const container = document.createElement("div");
        container.innerHTML = renderToString(<ServerPage />);
        expect(rpc).not.toHaveBeenCalled();
        const html = container.innerHTML;
        expect(html).toBe(enabled === false ? "<p>Idle</p>" : "<p>Loading</p>");
        const recoverable = vi.fn();
        let root!: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(container, <BrowserPage />, { onRecoverableError: recoverable });
        });
        expect(container.innerHTML).toBe(html);
        expect(recoverable).not.toHaveBeenCalled();
        expect(rpc).toHaveBeenCalledTimes(enabled === false ? 0 : 1);
        await act(async () => {
            root.unmount();
            resolve({ data: "value", stats: { remainingRequests: 5, resetInSeconds: 10 } });
            await pending;
        });
    });

    it("rejects browser-only RPC and streaming operations", async () => {
        const adapter = createServerClientAdapter(React, "ssr");
        await expect(adapter.callMethod()).rejects.toThrow("only available in the browser");
        await expect(adapter.streamRpc()).rejects.toThrow("only available in the browser");
        await expect(adapter.useStreaming().start(undefined)).rejects.toThrow("only available in the browser");
    });

    it("filters private environment values and retains transition/prefetch exports", () => {
        vi.stubEnv("HELIUM_PUBLIC_FIXTURE", "public");
        vi.stubEnv("PRIVATE_FIXTURE", "private");
        const adapter = createServerClientAdapter(React, "ssr");
        expect(adapter.getPublicEnvValue("HELIUM_PUBLIC_FIXTURE")).toBe("public");
        expect(adapter.getPublicEnvValue("PRIVATE_FIXTURE")).toBeUndefined();
        expect(generateServerTransitionsModule("ssg")).toContain("export default");
        expect(generateServerTransitionsModule("ssr")).not.toContain("export default");
        expect(generateServerPrefetchModule()).toContain("export function clearPrefetchCache()");
        vi.unstubAllEnvs();
    });
});
