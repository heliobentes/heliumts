// @vitest-environment node
import { EventEmitter } from "events";
import type { IncomingMessage, Server, ServerResponse } from "http";
import { describe, expect, it } from "vitest";

import { abortServerRequests, getRequestSignal, trackRequestCleanup, trackServerRequest } from "../../src/server/requestSignal";

function request(server: Server) {
    const req = Object.assign(new EventEmitter(), { aborted: false }) as IncomingMessage;
    const res = Object.assign(new EventEmitter(), { destroyed: false, writableFinished: false }) as ServerResponse;
    trackServerRequest(server, req, res);
    return { req, res, signal: getRequestSignal(req, res) };
}

describe("server request cancellation", () => {
    it("aborts synchronously and leaves requests belonging to another server active", async () => {
        const first = {} as Server;
        const second = {} as Server;
        const one = request(first);
        const two = request(second);
        const stopped = abortServerRequests(first);
        expect(one.signal.aborted).toBe(true);
        expect(two.signal.aborted).toBe(false);
        await stopped;
        await abortServerRequests(second);
    });

    it("waits for cooperative provider cleanup after abort even if the response closes", async () => {
        const server = {} as Server;
        const { req, res, signal } = request(server);
        let finish!: () => void;
        const cleanup = new Promise<void>((resolve) => {
            finish = resolve;
        });
        signal.addEventListener("abort", () => {
            queueMicrotask(() => trackRequestCleanup(req, cleanup));
        });
        let finished = false;
        const stopped = abortServerRequests(server).then(() => {
            finished = true;
        });
        res.emit("close");
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(finished).toBe(false);
        finish();
        await stopped;
        expect(finished).toBe(true);
    });

    it("bounds shutdown when a provider ignores cancellation", async () => {
        const server = {} as Server;
        const { req, signal } = request(server);
        trackRequestCleanup(req, new Promise<void>(() => {}));
        await abortServerRequests(server, 10);
        expect(signal.aborted).toBe(true);
    });

    it("removes completed requests before a later shutdown", async () => {
        const server = {} as Server;
        const { res, signal } = request(server);
        res.emit("finish");
        await abortServerRequests(server);
        expect(signal.aborted).toBe(false);
        expect(res.listenerCount("close")).toBe(0);
    });
});
