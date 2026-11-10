import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateAll } from "../../src/client/cache";
import { RouterContext, useRouter } from "../../src/client/Router";
import { rpcCall } from "../../src/client/rpcClient";
import { methodReference } from "./methodReference";
import { useCall } from "../../src/client/useCall";
import { useFetch } from "../../src/client/useFetch";

vi.mock("../../src/client/rpcClient", () => ({ rpcCall: vi.fn() }));
vi.mock("../../src/client/routerManifest", () => ({ buildRoutes: vi.fn() }));

type Article = { id: string; title: string };
const getArticle = methodReference<{ id: string }, Article>("guide.getArticle");
const listArticles = methodReference<void, Article[]>("guide.listArticles");
const saveArticle = methodReference<Article, Article>("guide.saveArticle");
const stats = { remainingRequests: 100, resetInSeconds: 60 };

// Execute the canonical Markdown, so tests cannot silently drift from the guide.
function example<Props>(filename: string): React.ComponentType<Props> {
    const guide = fs.readFileSync("docs/agent-guide.md", "utf8");
    const source = [...guide.matchAll(/```tsx file=(\S+)\n([\s\S]*?)\n```/g)].find((match) => match[1] === filename)?.[2];
    if (!source) throw new Error(`Missing documented example: ${filename}`);
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const modules: Record<string, unknown> = {
        react: React,
        "react/jsx-runtime": jsxRuntime,
        "heliumts/client": { useCall, useRouter },
        "../rpc.generated": { getArticle, listArticles, saveArticle },
    };
    const exports: { default?: React.ComponentType<Props> } = {};
    new Function("require", "exports", compiled)((id: string) => {
        if (!(id in modules)) throw new Error(`Unexpected example import: ${id}`);
        return modules[id];
    }, exports);
    if (!exports.default) throw new Error(`Missing example component: ${filename}`);
    return exports.default;
}

const ArticleEditor = example<{ article: Article }>("src/components/ArticleEditor.tsx");
const ArticleFilters = example<Record<string, never>>("src/components/ArticleFilters.tsx");
const mockRpc = vi.mocked(rpcCall);

function ArticlePage() {
    const detail = useFetch(getArticle, { id: "one" });
    const list = useFetch(listArticles);
    return (
        <>
            <output aria-label="Article list">{list.data?.map((article) => article.title).join(", ")}</output>
            {detail.data && <ArticleEditor article={detail.data} />}
        </>
    );
}

describe("documented form and invalidation", () => {
    beforeEach(() => {
        invalidateAll();
        mockRpc.mockReset();
    });
    afterEach(() => {
        cleanup();
        invalidateAll();
    });

    it("keeps an edited draft across refetches and scopes it to the current record", () => {
        const { rerender } = render(<ArticleEditor article={{ id: "one", title: "Original" }} />);
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
        rerender(<ArticleEditor article={{ id: "one", title: "Refetched" }} />);
        expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Draft");
        rerender(<ArticleEditor article={{ id: "two", title: "Second" }} />);
        expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Second");
    });

    it("refreshes the detail and cached list after a successful save", async () => {
        let article: Article = { id: "one", title: "Original" };
        mockRpc.mockImplementation(async (method, args) => {
            if (method === saveArticle.__id) article = { ...(args as Article) };
            return { data: method === listArticles.__id ? [{ ...article }] : { ...article }, stats };
        });
        render(<ArticlePage />);
        await screen.findByLabelText("Title");
        await waitFor(() => expect(screen.getByLabelText("Article list").textContent).toBe("Original"));
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByLabelText("Article list").textContent).toBe("Updated"));
        await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Updated"));
        expect(mockRpc.mock.calls.filter(([id]) => id === getArticle.__id)).toHaveLength(2);
        expect(mockRpc.mock.calls.filter(([id]) => id === listArticles.__id)).toHaveLength(2);
        expect(mockRpc).toHaveBeenCalledWith(saveArticle.__id, { id: "one", title: "Updated" });
    });

    it("retains the draft and cached reads when saving fails, then supports retry", async () => {
        let article: Article = { id: "one", title: "Original" };
        let fail = true;
        mockRpc.mockImplementation(async (method, args) => {
            if (method === saveArticle.__id) {
                if (fail) throw new Error("Permission denied");
                article = { ...(args as Article) };
            }
            return { data: method === listArticles.__id ? [{ ...article }] : { ...article }, stats };
        });
        render(<ArticlePage />);
        await screen.findByLabelText("Title");
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect((await screen.findByRole("alert")).textContent).toBe("Permission denied");
        expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Draft");
        expect(screen.getByLabelText("Article list").textContent).toBe("Original");
        expect(mockRpc.mock.calls.filter(([id]) => id === getArticle.__id)).toHaveLength(1);
        expect(mockRpc.mock.calls.filter(([id]) => id === listArticles.__id)).toHaveLength(1);
        fail = false;
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(screen.getByLabelText("Article list").textContent).toBe("Draft"));
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("disables the form during a save and submits only once", async () => {
        let finish!: (value: { data: Article; stats: typeof stats }) => void;
        mockRpc.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        render(<ArticleEditor article={{ id: "one", title: "Original" }} />);
        const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
        fireEvent.click(button);
        expect(button.disabled).toBe(true);
        expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(true);
        fireEvent.submit(button.closest("form")!);
        expect(mockRpc).toHaveBeenCalledTimes(1);
        finish({ data: { id: "one", title: "Original" }, stats });
        await waitFor(() => expect(button.disabled).toBe(false));
    });
});

it("the query example preserves unrelated values and uses replace without mutating router state", () => {
    const searchParams = new URLSearchParams("q=hello+world&tag=a&tag=b&status=closed");
    const replace = vi.fn();
    const push = vi.fn();
    render(
        <RouterContext.Provider
            value={{
                path: "/articles",
                params: {},
                searchParams,
                replace,
                push,
                on: () => () => {},
                status: 200,
                isNavigating: false,
                isPending: false,
            }}
        >
            <ArticleFilters />
        </RouterContext.Provider>
    );
    try {
        fireEvent.click(screen.getByRole("button", { name: "Show open (current: closed)" }));
        expect(replace).toHaveBeenCalledWith("/articles?q=hello+world&tag=a&tag=b&status=open", { scrollToTop: false });
        expect(push).not.toHaveBeenCalled();
        expect(searchParams.toString()).toBe("q=hello+world&tag=a&tag=b&status=closed");
    } finally {
        cleanup();
    }
});
