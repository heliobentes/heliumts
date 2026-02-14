const STALE_RESUME_THRESHOLD_MS = 30 * 60 * 1000;
const RELOAD_COOLDOWN_MS = 30 * 1000;

const INSTALL_FLAG = "__helium_stale_client_recovery_installed__";
const HIDDEN_AT_STORAGE_KEY = "__helium_stale_client_hidden_at__";
const LAST_RELOAD_STORAGE_KEY = "__helium_stale_client_last_reload_at__";

const CHUNK_ERROR_PATTERNS: RegExp[] = [
    /ChunkLoadError/i,
    /Loading chunk\s+\d+\s+failed/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
    /dynamically imported module/i,
];

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type InstallStaleClientRecoveryOptions = {
    windowObject?: Window;
    documentObject?: Document;
    storage?: StorageLike | null;
    now?: () => number;
    reload?: () => void;
    staleThresholdMs?: number;
    reloadCooldownMs?: number;
    disableDedupe?: boolean;
};

type WindowWithInstallFlag = Window & {
    [INSTALL_FLAG]?: boolean;
};

function readStoredNumber(storage: StorageLike | null, key: string): number | null {
    if (!storage) {
        return null;
    }

    try {
        const raw = storage.getItem(key);
        if (!raw) {
            return null;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function writeStoredNumber(storage: StorageLike | null, key: string, value: number | null): void {
    if (!storage) {
        return;
    }

    try {
        if (value === null) {
            storage.removeItem(key);
            return;
        }
        storage.setItem(key, String(value));
    } catch {
        // Ignore storage write failures (private mode, quota exceeded, etc.)
    }
}

function extractErrorText(reason: unknown): string {
    if (typeof reason === "string") {
        return reason;
    }

    if (reason instanceof Error) {
        return `${reason.name}: ${reason.message}`;
    }

    if (typeof reason === "object" && reason !== null) {
        const maybeMessage = Reflect.get(reason, "message");
        if (typeof maybeMessage === "string") {
            return maybeMessage;
        }

        const maybeName = Reflect.get(reason, "name");
        if (typeof maybeName === "string") {
            return maybeName;
        }
    }

    return "";
}

/**
 * @internal Exported for testing
 */
export function isChunkLoadError(reason: unknown): boolean {
    if (reason instanceof Error && reason.name === "ChunkLoadError") {
        return true;
    }

    const text = extractErrorText(reason);
    if (!text) {
        return false;
    }

    return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Installs default stale-client recovery for mobile suspend/resume and stale chunks.
 *
 * @internal Exported for testing
 */
export function installStaleClientRecovery(options: InstallStaleClientRecoveryOptions = {}): void {
    const windowObject = options.windowObject ?? (typeof window !== "undefined" ? window : undefined);
    const documentObject = options.documentObject ?? (typeof document !== "undefined" ? document : undefined);

    if (!windowObject || !documentObject) {
        return;
    }

    const trackedWindow = windowObject as WindowWithInstallFlag;
    if (!options.disableDedupe && trackedWindow[INSTALL_FLAG]) {
        return;
    }
    trackedWindow[INSTALL_FLAG] = true;

    const now = options.now ?? (() => Date.now());
    const storage = options.storage ?? windowObject.sessionStorage;
    const staleThresholdMs = options.staleThresholdMs ?? STALE_RESUME_THRESHOLD_MS;
    const reloadCooldownMs = options.reloadCooldownMs ?? RELOAD_COOLDOWN_MS;
    const reload = options.reload ?? (() => windowObject.location.reload());

    let isReloading = false;
    let hiddenAt = readStoredNumber(storage, HIDDEN_AT_STORAGE_KEY);

    const markHidden = () => {
        hiddenAt = now();
        writeStoredNumber(storage, HIDDEN_AT_STORAGE_KEY, hiddenAt);
    };

    const clearHidden = () => {
        hiddenAt = null;
        writeStoredNumber(storage, HIDDEN_AT_STORAGE_KEY, null);
    };

    const attemptReload = () => {
        if (isReloading) {
            return;
        }

        const current = now();
        const lastReloadAt = readStoredNumber(storage, LAST_RELOAD_STORAGE_KEY) ?? 0;
        if (current - lastReloadAt < reloadCooldownMs) {
            return;
        }

        isReloading = true;
        writeStoredNumber(storage, LAST_RELOAD_STORAGE_KEY, current);
        reload();
    };

    const maybeRecoverFromStaleResume = () => {
        const hiddenTimestamp = hiddenAt ?? readStoredNumber(storage, HIDDEN_AT_STORAGE_KEY);
        if (hiddenTimestamp === null) {
            return;
        }

        const hiddenDuration = now() - hiddenTimestamp;
        clearHidden();
        if (hiddenDuration >= staleThresholdMs) {
            attemptReload();
        }
    };

    documentObject.addEventListener(
        "visibilitychange",
        () => {
            if (documentObject.hidden) {
                markHidden();
                return;
            }
            maybeRecoverFromStaleResume();
        },
        { passive: true }
    );

    windowObject.addEventListener(
        "pagehide",
        () => {
            markHidden();
        },
        { passive: true }
    );

    windowObject.addEventListener(
        "pageshow",
        (event) => {
            if ((event as PageTransitionEvent).persisted) {
                maybeRecoverFromStaleResume();
            }
        },
        { passive: true }
    );

    windowObject.addEventListener("error", (event) => {
        const errorEvent = event as ErrorEvent;
        if (isChunkLoadError(errorEvent.error ?? errorEvent.message)) {
            attemptReload();
        }
    });

    windowObject.addEventListener("unhandledrejection", (event) => {
        const rejectionEvent = event as PromiseRejectionEvent;
        if (isChunkLoadError(rejectionEvent.reason)) {
            attemptReload();
        }
    });
}
