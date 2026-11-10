export interface PageRoute {
    pattern: string;
    render: "spa" | "ssr" | "ssg";
}

/** Convert a POSIX path relative to the pages directory to a route pattern. */
export function pathFromPageFile(file: string): string {
    const path = (file.startsWith("/") ? file : `/${file}`).replace(/\.(tsx|jsx|ts|js)$/, "");
    if (path === "/404") {
        return "__404__";
    }

    const pattern = path.replace(/\/\([^)]+\)/g, "").replace(/\/index$/, "") || "/";
    return pattern.replace(/\[\.\.\.(.+?)\]/g, "*$1").replace(/\[(.+?)\]/g, ":$1");
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** Match a file route and decode its dynamic or catch-all parameters. */
export function createMatcher(pattern: string, onInvalidCatchAll?: () => void) {
    const segments = pattern.split("/").filter(Boolean);
    const catchAllIndex = segments.findIndex((segment) => segment.startsWith("*"));
    const hasCatchAll = catchAllIndex !== -1;
    const fixedLength = hasCatchAll ? catchAllIndex : segments.length;

    return (path: string) => {
        if (hasCatchAll && catchAllIndex !== segments.length - 1) {
            onInvalidCatchAll?.();
            return null;
        }

        const pathSegments = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
        if (pathSegments.length < fixedLength || (!hasCatchAll && pathSegments.length > fixedLength)) {
            return null;
        }

        const params: Record<string, string | string[]> = {};
        for (let index = 0; index < fixedLength; index++) {
            const segment = segments[index];
            const value = pathSegments[index];
            if (segment.startsWith(":")) {
                params[segment.slice(1)] = decodeSegment(value);
            } else if (segment !== value) {
                return null;
            }
        }

        if (hasCatchAll) {
            params[segments[catchAllIndex].slice(1)] = pathSegments.slice(catchAllIndex).map(decodeSegment);
        }
        return { params };
    };
}
