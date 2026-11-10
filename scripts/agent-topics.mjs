// Canonical generator. Body text appears once in agent-guide.md, under task headings.
export const topics = [
    ["workflow", "Orient in an installed app", "Start and verify", [], ["scaffold", "verify"]],
    ["scaffold", "Scaffold a minimal app", "Start and verify", [], ["verify"]],
    ["verify", "Verify an application", "Start and verify", ["scaffold"], ["server-files"]],
    ["guide-index", "Open the guide index", "Start and verify", [], ["guide-get"]],
    ["guide-get", "Read one guide", "Start and verify", ["guide-index"], []],
    ["imports", "Keep imports at the right boundary", "Imports and files", [], ["server-files", "validation-page"]],
    ["api-reference", "Find installed public API types", "Imports and files", ["imports"], ["request-context", "routing"]],
    ["server-files", "Place discoverable server files", "Imports and files", ["imports"], ["validation", "verify"]],
    ["validation", "Define one validated method", "One validated method and page", ["imports", "server-files"], ["input-validation", "validation-page"]],
    ["input-validation", "Understand input parser behavior", "One validated method and page", ["validation"], ["security"]],
    ["request-context", "Use request context safely", "One validated method and page", ["validation"], ["api-reference", "security"]],
    ["validation-page", "Call a validated method from a page", "One validated method and page", ["validation", "imports"], ["operations"]],
    ["operations", "Read and cache data", "Choose one operation", ["validation-page"], ["mutations", "streaming"]],
    ["mutations", "Mutate and invalidate data", "Choose one operation", ["validation-page"], ["operations"]],
    ["editable-forms", "Edit fetched data without a synchronization effect", "Choose one operation", ["validation-page", "mutations"], ["operations"]],
    ["streaming", "Consume an HTTP stream", "Choose one operation", ["imports", "server-files"], ["http-handlers", "security"]],
    ["http-handlers", "Choose an explicit HTTP endpoint", "Choose one operation", ["imports", "server-files"], ["security"]],
    ["routing", "Navigate with file routes", "Routing and navigation", ["imports"], ["query-params", "api-reference"]],
    ["query-params", "Read and update query parameters", "Routing and navigation", ["routing"], ["operations", "input-validation"]],
    ["rendering", "Choose a rendering mode", "Rendering and security", ["imports"], ["security"]],
    ["security", "Preserve application security", "Rendering and security", [], ["input-validation", "rendering"]],
    ["measuring", "Measure successful agent tasks", "Measuring AI efficiency", [], []],
];

export const MAX_GUIDE_BYTES = 5000;

export function generateTopics(source) {
    const sections = new Map();
    const categories = new Set(topics.map(([, , category]) => category));
    let category;
    let heading;
    let preamble = "";
    let fence;
    for (const line of source.split("\n")) {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
        }
        const group = !fence && line.match(/^## (.+)$/);
        const task = !fence && line.match(/^### (.+)$/);
        if (group) {
            category = group[1];
            if (!categories.has(category)) throw new Error("Guide sections changed; update the task map.");
            heading = undefined;
        } else if (task) {
            heading = task[1];
            if (sections.has(heading)) throw new Error(`Duplicate guide section: ${heading}`);
            const definition = topics.find(([, title]) => title === heading);
            if (!definition || definition[2] !== category) throw new Error("Guide sections changed; update the task map.");
            sections.set(heading, "");
        } else if (heading) sections.set(heading, sections.get(heading) + line + "\n");
        else if (!category) preamble += line + "\n";
        else if (line.trim()) throw new Error("Unassigned guide content; put every paragraph under a task heading.");
    }
    if (fence) throw new Error("Unclosed guide code fence.");
    const warning = preamble.replace(/^# .+\n+/, "").trim();
    if (!warning || !/\b(?:\d+\.\d+\.\d+|unreleased)\b/i.test(warning)) throw new Error("Guide must include its version notice.");
    if (sections.size !== topics.length || topics.some(([, title]) => !sections.get(title)?.trim())) {
        throw new Error("Guide sections changed; update the task map so no content is omitted.");
    }
    const files = new Map();
    const link = (id) => {
        const topic = topics.find(([slug]) => slug === id);
        if (!topic) throw new Error(`Unknown guide link: ${id}`);
        return `[${topic[1]}](./${id}.md)`;
    };
    const index = [...categories].map((category) => `## ${category}\n\n${topics.filter(([, , group]) => group === category).map(([id, title]) => `- ${id}: [${title}](./${id}.md)`).join("\n")}`).join("\n\n");
    files.set("index.md", `# HeliumTS task guide index\n\n${warning}\n\nRead the app's AGENTS.md, then open only the Markdown guide needed using the links below.\n\n${index}\n`);
    for (const [id, title, , prerequisites, related] of topics) {
        const before = prerequisites.length ? prerequisites.map(link).join(", ") : "None beyond an installed HeliumTS app.";
        const after = related.length ? `\n\nRelated: ${related.map(link).join(", ")}.` : "";
        const content = `# ${title}\n\n${warning}\n\nPrerequisites: ${before}\n\n${sections.get(title).trim()}${after}\n`;
        if (Buffer.byteLength(content) > MAX_GUIDE_BYTES) throw new Error(`Guide ${id} exceeds ${MAX_GUIDE_BYTES} bytes; split it into smaller tasks.`);
        files.set(`${id}.md`, content);
    }
    return files;
}
