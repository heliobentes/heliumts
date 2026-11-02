import type { IncomingMessage, Server, ServerResponse } from "http";

interface RequestState {
    controller: AbortController;
    pendingCleanup: Set<Promise<unknown>>;
    server?: Server;
}

const requests = new WeakMap<IncomingMessage, RequestState>();
const serverRequests = new WeakMap<Server, Set<RequestState>>();

/** One cancellation signal per HTTP request, shared by middleware and handlers. */
export function getRequestSignal(req: IncomingMessage, res: ServerResponse): AbortSignal {
    const existing = requests.get(req);
    if (existing) {
        return existing.controller.signal;
    }
    const controller = new AbortController();
    const state: RequestState = { controller, pendingCleanup: new Set() };
    requests.set(req, state);
    const abort = () => controller.abort(new Error("Client disconnected"));
    const cleanup = () => {
        req.off?.("aborted", abort);
        req.off?.("error", abort);
        res.off?.("close", onClose);
        res.off?.("finish", cleanup);
        res.off?.("error", abort);
        if (state.server) {
            serverRequests.get(state.server)?.delete(state);
        }
    };
    const onClose = () => {
        if (!res.writableFinished) {
            abort();
        }
        cleanup();
    };
    req.once?.("aborted", abort);
    req.once?.("error", abort);
    res.once?.("close", onClose);
    res.once?.("finish", cleanup);
    res.once?.("error", abort);
    if (req.aborted || res.destroyed) {
        abort();
    }
    return controller.signal;
}

/** Associate cancellation with its own server, never other servers in this process. */
export function trackServerRequest(server: Server, req: IncomingMessage, res: ServerResponse): void {
    getRequestSignal(req, res);
    const state = requests.get(req)!;
    state.server = server;
    let active = serverRequests.get(server);
    if (!active) {
        active = new Set();
        serverRequests.set(server, active);
    }
    active.add(state);
}

/** Keep cooperative iterator cleanup observable even after the response closes. */
export function trackRequestCleanup<T>(req: IncomingMessage, value: PromiseLike<T> | T): Promise<T> {
    const promise = Promise.resolve(value);
    const pending = requests.get(req)?.pendingCleanup;
    pending?.add(promise);
    void promise.then(
        () => pending?.delete(promise),
        () => pending?.delete(promise)
    );
    return promise;
}

/** Abort synchronously, then allow bounded provider cleanup before process exit. */
export async function abortServerRequests(server: Server, cleanupTimeoutMs = 1000): Promise<void> {
    const active = [...(serverRequests.get(server) ?? [])];
    for (const state of active) {
        state.controller.abort(new Error("Server shutting down"));
    }
    // Direct abort listeners resume iterator work before this turn. Socket close
    // events are deliberately not the trigger for shutdown cancellation.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pending = active.flatMap((state) => [...state.pendingCleanup]);
    if (pending.length > 0) {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, cleanupTimeoutMs);
            void Promise.allSettled(pending).then(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
}
