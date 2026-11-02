import type http from "http";
import React from "react";
import { describe, expect, it } from "vitest";

import type { HeliumContext } from "../../src/server/context";
import type { SSRPageDef } from "../../src/server/ssr";
import { matchSSRPage, renderSSRHTML, resolveServerSideProps } from "../../src/server/ssr";

function createMockIncomingMessage(url: string): http.IncomingMessage {
    return {
        method: "GET",
        url,
        headers: {},
    } as http.IncomingMessage;
}

function createMockContext(req: http.IncomingMessage): HeliumContext {
    return {
        req: {
            ip: "127.0.0.1",
            headers: req.headers,
            url: req.url,
            method: req.method,
            raw: req,
        },
    };
}

function createBaseSSRPage(overrides: Partial<SSRPageDef> = {}): SSRPageDef {
    return {
        pathPattern: "/",
        loadComponent: async () => () => React.createElement("div", null, "page"),
        loadLayouts: async () => [],
        ...overrides,
    };
}

describe("ssr", () => {
    it("should preserve malformed encoded route parameters without crashing", () => {
        const page = createBaseSSRPage({ pathPattern: "/items/:id" });
        expect(matchSSRPage("/items/%ZZ", [page])?.params).toEqual({ id: "%ZZ" });
        const catchAll = createBaseSSRPage({ pathPattern: "/files/*path" });
        expect(matchSSRPage("/files/%ZZ/hello%20world", [catchAll])?.params).toEqual({ path: ["%ZZ", "hello world"] });
    });

    it("should prioritize static segments over dynamic segments regardless of discovery order", () => {
        const dynamic = createBaseSSRPage({ pathPattern: "/:longParameter/edit" });
        const specific = createBaseSSRPage({ pathPattern: "/users/:id" });
        const pages = [dynamic, specific];
        expect(matchSSRPage("/users/edit", pages)?.page).toBe(specific);
        expect(pages).toEqual([dynamic, specific]);
    });

    describe("resolveServerSideProps", () => {
        it("should use the target page query when resolving props through the internal endpoint", async () => {
            const req = createMockIncomingMessage("/__helium__/page-props?path=%2Fsearch%3Fq%3Dhelium");
            const result = await resolveServerSideProps({
                req,
                pathname: "/search",
                search: "?q=helium",
                params: {},
                page: createBaseSSRPage({ getServerSideProps: async (request) => ({ query: request.query }) }),
                ctx: createMockContext(req),
            });
            expect(result).toEqual({ kind: "props", props: { query: { q: "helium" } } });
        });

        it("should return empty props when getServerSideProps is not defined", async () => {
            const req = createMockIncomingMessage("/");
            const ctx = createMockContext(req);
            const page = createBaseSSRPage();

            const result = await resolveServerSideProps({
                req,
                pathname: "/",
                params: {},
                page,
                ctx,
            });

            expect(result).toEqual({ kind: "props", props: {} });
        });

        it("should normalize redirect with default status and replace", async () => {
            const req = createMockIncomingMessage("/");
            const ctx = createMockContext(req);
            const page = createBaseSSRPage({
                getServerSideProps: async () => ({
                    redirect: {
                        destination: "/billing",
                    },
                }),
            });

            const result = await resolveServerSideProps({
                req,
                pathname: "/",
                params: {},
                page,
                ctx,
            });

            expect(result).toEqual({
                kind: "redirect",
                redirect: {
                    destination: "/billing",
                    statusCode: 307,
                    replace: true,
                },
            });
        });

        it("should honor explicit redirect status and replace", async () => {
            const req = createMockIncomingMessage("/");
            const ctx = createMockContext(req);
            const page = createBaseSSRPage({
                getServerSideProps: async () => ({
                    redirect: {
                        destination: "/paywall",
                        statusCode: 302,
                        replace: false,
                    },
                }),
            });

            const result = await resolveServerSideProps({
                req,
                pathname: "/",
                params: {},
                page,
                ctx,
            });

            expect(result).toEqual({
                kind: "redirect",
                redirect: {
                    destination: "/paywall",
                    statusCode: 302,
                    replace: false,
                },
            });
        });
    });

    describe("renderSSRHTML", () => {
        it("should render into a root with preceding attributes and single quotes", async () => {
            const req = createMockIncomingMessage("/");
            const result = await renderSSRHTML({
                htmlTemplate: "<HTML><BODY><div class='app' id = 'root'></div></BODY></HTML>",
                pathname: "/",
                search: "",
                params: {},
                page: createBaseSSRPage(),
                req,
                ctx: createMockContext(req),
            });
            if (!("html" in result)) {
                throw new Error("Expected HTML result");
            }
            expect(result.html).toContain("<div class='app' id = 'root'><div>page</div></div>");
            expect(result.html).toContain("</script>\n</BODY></HTML>");
        });

        it("replaces nested loading placeholders without leaving old siblings or changing root attributes", async () => {
            const req = createMockIncomingMessage("/");
            const result = await renderSSRHTML({
                htmlTemplate: '<html><body><div class="app" id=root><div class="spinner"><div>Loading</div></div><p>Wait</p></div><footer>Keep</footer></body></html>',
                pathname: "/",
                search: "",
                params: {},
                page: createBaseSSRPage(),
                req,
                ctx: createMockContext(req),
            });
            expect("html" in result).toBe(true);
            if (!("html" in result)) {
                throw new Error("Expected HTML");
            }
            expect(result.html).toContain('<div class="app" id=root><div>page</div></div><footer>Keep</footer>');
            expect(result.html).not.toContain("spinner");
            expect(result.html).not.toContain("Wait");
        });

        it("should preserve dollar replacement tokens in markup and bootstrap props", async () => {
            const req = createMockIncomingMessage("/prices?currency=usd");
            const text = "Price $$ and $& and $` and $'";
            const result = await renderSSRHTML({
                htmlTemplate: '<html><body><div id="root"></div></body></html>',
                pathname: "/prices",
                search: "?currency=usd",
                params: {},
                page: createBaseSSRPage({
                    getServerSideProps: async () => ({ text }),
                    loadComponent: async () => () => React.createElement("p", null, text),
                }),
                req,
                ctx: createMockContext(req),
            });
            if (!("html" in result)) {
                throw new Error("Expected HTML result");
            }
            expect(result.html).toContain("<p>Price $$ and $&amp; and $` and $&#x27;</p>");
            expect(result.html).toContain(JSON.stringify({ path: "/prices", search: "?currency=usd", props: { text } }));
            expect(result.html.match(/<body>/g)).toHaveLength(1);
        });

        it("should propagate layout failures instead of rendering a page without its layout", async () => {
            const req = createMockIncomingMessage("/private");
            const error = new Error("Layout guard rejected the request");
            await expect(
                renderSSRHTML({
                    htmlTemplate: '<html><body><div id="root"></div></body></html>',
                    pathname: "/private",
                    search: "",
                    params: {},
                    page: createBaseSSRPage({
                        loadLayouts: async () => [
                            () => {
                                throw error;
                            },
                        ],
                    }),
                    req,
                    ctx: createMockContext(req),
                })
            ).rejects.toBe(error);
            expect((globalThis as { __HELIUM_SSR_ROUTER__?: unknown }).__HELIUM_SSR_ROUTER__).toBeUndefined();
        });

        it("should return redirect result when getServerSideProps returns redirect", async () => {
            const req = createMockIncomingMessage("/");
            const ctx = createMockContext(req);
            const page = createBaseSSRPage({
                getServerSideProps: async () => ({
                    redirect: {
                        destination: "/billing",
                        permanent: true,
                    },
                }),
            });

            const rendered = await renderSSRHTML({
                htmlTemplate: '<!doctype html><html><body><div id="root"></div></body></html>',
                pathname: "/",
                search: "",
                params: {},
                page,
                req,
                ctx,
            });

            expect(rendered).toEqual({
                redirect: {
                    destination: "/billing",
                    statusCode: 308,
                    replace: true,
                },
            });
        });

        it("should render HTML and inject SSR payload for props", async () => {
            const req = createMockIncomingMessage("/dashboard");
            const ctx = createMockContext(req);
            const page = createBaseSSRPage({
                getServerSideProps: async () => ({
                    accountStatus: "active",
                }),
                loadComponent:
                    async () =>
                    ({ accountStatus }: { accountStatus?: string }) =>
                        React.createElement("div", null, accountStatus || "unknown"),
            });

            const rendered = await renderSSRHTML({
                htmlTemplate: '<!doctype html><html><body><div id="root"></div></body></html>',
                pathname: "/dashboard",
                search: "",
                params: {},
                page,
                req,
                ctx,
            });

            if ("redirect" in rendered) {
                throw new Error("Expected HTML render result, got redirect");
            }

            expect(rendered.html).toContain("accountStatus");
            expect(rendered.html).toContain("active");
        });
    });
});
