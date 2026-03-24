import type http from "http";
import React from "react";
import { describe, expect, it } from "vitest";

import type { HeliumContext } from "../../src/server/context";
import type { SSRPageDef } from "../../src/server/ssr";
import { renderSSRHTML, resolveServerSideProps } from "../../src/server/ssr";

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
    describe("resolveServerSideProps", () => {
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
