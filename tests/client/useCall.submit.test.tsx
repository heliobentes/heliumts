import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invalidateByMethod } from "../../src/client/cache";
import { rpcCall } from "../../src/client/rpcClient";
import { RpcError } from "../../src/client/RpcError";
import { useCall } from "../../src/client/useCall";

import { methodReference } from "./methodReference";

vi.mock("../../src/client/rpcClient", () => ({ rpcCall: vi.fn() }));
vi.mock("../../src/client/cache", () => ({ invalidateByMethod: vi.fn() }));
const rpc = vi.mocked(rpcCall);
const stats = { remainingRequests: 99, resetInSeconds: 0 };
const saveTask = methodReference<{ title: string }, { title: string }>("saveTask");
const detail = methodReference("getTask");
const list = methodReference("listTasks");
function pending() {
    let resolve!: (value: { data: { title: string }; stats: typeof stats }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ data: { title: string }; stats: typeof stats }>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
beforeEach(() => vi.resetAllMocks());

describe("handled useCall submissions", () => {
    it("suppresses same-tick duplicate submissions before React rerenders, then refreshes only explicit reads", async () => {
        const request = pending();
        rpc.mockReturnValue(request.promise);
        const success = vi.fn();
        const { result } = renderHook(() => useCall(saveTask, { invalidate: [detail, list], onSuccess: success }));
        let first!: ReturnType<typeof result.current.submit>;
        let duplicate!: typeof first;
        act(() => {
            first = result.current.submit({ title: "First" });
            duplicate = result.current.submit({ title: "Duplicate" });
        });
        await expect(duplicate).resolves.toEqual({ status: "busy" });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(result.current.isCalling).toBe(true);
        expect(success).not.toHaveBeenCalled();
        expect(invalidateByMethod).not.toHaveBeenCalled();
        await act(async () => {
            request.resolve({ data: { title: "Saved" }, stats });
            await first;
        });
        await expect(first).resolves.toEqual({ status: "success", data: { title: "Saved" } });
        expect(result.current.isCalling).toBe(false);
        expect(success).toHaveBeenCalledTimes(1);
        expect(vi.mocked(invalidateByMethod).mock.calls).toEqual([["getTask"], ["listTasks"]]);
    });
    it("handles rejection with original RPC metadata and unlocks retry without invalidation", async () => {
        const error = new RpcError("Try again", { remainingRequests: 0, resetInSeconds: 1 });
        rpc.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: { title: "Retried" }, stats });
        const { result } = renderHook(() => useCall(saveTask, { invalidate: [detail, list] }));
        await act(async () => {
            expect(await result.current.submit({ title: "Draft" })).toEqual({ status: "error", error });
        });
        expect(result.current.error).toBe("Try again");
        expect(result.current.isCalling).toBe(false);
        expect(invalidateByMethod).not.toHaveBeenCalled();
        await act(async () => {
            expect((await result.current.submit({ title: "Draft" })).status).toBe("success");
        });
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBeNull();
    });
    it("is busy during ordinary call but preserves its concurrent and rejecting behavior", async () => {
        const request = pending();
        rpc.mockReturnValue(request.promise);
        const { result } = renderHook(() => useCall(saveTask));
        let first!: ReturnType<typeof result.current.call>;
        let second!: typeof first;
        act(() => {
            first = result.current.call({ title: "One" });
            second = result.current.call({ title: "Two" });
        });
        expect(await result.current.submit({ title: "Blocked" })).toEqual({ status: "busy" });
        expect(rpc).toHaveBeenCalledTimes(2);
        await act(async () => {
            request.resolve({ data: { title: "Done" }, stats });
            await Promise.all([first, second]);
        });
        rpc.mockRejectedValueOnce(new Error("Still rejects"));
        await act(async () => {
            await expect(result.current.call({ title: "Three" })).rejects.toThrow("Still rejects");
        });
    });
    it("does not claim server rollback when a post-success callback throws", async () => {
        rpc.mockResolvedValue({ data: { title: "Committed" }, stats });
        const { result } = renderHook(() =>
            useCall(saveTask, {
                invalidate: [list],
                onSuccess: () => {
                    throw new Error("UI callback failed");
                },
            })
        );
        await act(async () => {
            const outcome = await result.current.submit({ title: "Saved" });
            expect(outcome.status).toBe("error");
            if (outcome.status === "error") {
                expect(outcome.error).toBeInstanceOf(RpcError);
                expect(outcome.error.message).toBe("UI callback failed");
            }
        });
        expect(invalidateByMethod).toHaveBeenCalledWith("listTasks");
        expect(result.current.isCalling).toBe(false);
    });
    it("normalizes an escaped onError exception and releases pending state", async () => {
        rpc.mockRejectedValue(new Error("Transport failed"));
        const { result } = renderHook(() =>
            useCall(saveTask, {
                onError: () => {
                    throw new Error("Callback failed");
                },
            })
        );
        await act(async () => {
            const outcome = await result.current.submit({ title: "Draft" });
            expect(outcome.status).toBe("error");
            if (outcome.status === "error") {
                expect(outcome.error).toBeInstanceOf(RpcError);
                expect(outcome.error.message).toBe("Callback failed");
            }
        });
        expect(result.current.isCalling).toBe(false);
    });
    it("keeps separate hook instances independent", async () => {
        const request = pending();
        rpc.mockReturnValue(request.promise);
        const { result } = renderHook(() => [useCall(saveTask), useCall(saveTask)]);
        let requests!: Promise<unknown>[];
        act(() => {
            requests = result.current.map((hook) => hook.submit({ title: "Independent" }));
        });
        expect(rpc).toHaveBeenCalledTimes(2);
        await act(async () => {
            request.resolve({ data: { title: "Done" }, stats });
            await Promise.all(requests);
        });
    });
    it("retains the labelled form and draft after failure and succeeds on the same form retry", async () => {
        rpc.mockRejectedValueOnce(new Error("Save failed")).mockResolvedValueOnce({ data: { title: "Draft" }, stats });
        function Editor() {
            const [title, setTitle] = useState("Draft");
            const [saved, setSaved] = useState(false);
            const mutation = useCall(saveTask, { invalidate: [detail, list] });
            return (
                <form
                    aria-label="Edit task"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        const outcome = await mutation.submit({ title });
                        if (outcome.status === "success") {
                            setSaved(true);
                        }
                    }}
                >
                    <label>
                        Title
                        <input value={title} onChange={(event) => setTitle(event.target.value)} />
                    </label>
                    <button disabled={mutation.isCalling}>Save changes</button>
                    {mutation.error && <p role="alert">{mutation.error}</p>}
                    {saved && <p role="status">Saved</p>}
                </form>
            );
        }
        render(<Editor />);
        const form = screen.getByRole("form", { name: "Edit task" });
        await act(async () => {
            fireEvent.submit(form);
        });
        expect(screen.getByRole("alert").textContent).toBe("Save failed");
        expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Draft");
        expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
        await act(async () => {
            fireEvent.submit(form);
        });
        expect(screen.getByRole("form", { name: "Edit task" })).toBe(form);
        expect(screen.getByRole("status").textContent).toBe("Saved");
    });
});
