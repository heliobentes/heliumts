/** Order overlapping routes by the specificity of each segment, left to right. */
export function compareRoutePatterns(a: string, b: string): number {
    const aSegments = a.split("/").filter(Boolean);
    const bSegments = b.split("/").filter(Boolean);
    const rank = (segment: string) => (segment.startsWith("*") ? 0 : segment.startsWith(":") ? 1 : 2);

    for (let index = 0; index < Math.min(aSegments.length, bSegments.length); index++) {
        const difference = rank(bSegments[index]) - rank(aSegments[index]);
        if (difference !== 0) {
            return difference;
        }
    }

    // Exact routes precede a catch-all that can also match an empty suffix.
    return aSegments.length - bSegments.length;
}
