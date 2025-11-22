import { useFetch } from "helium/client";
import { getIP, getServerEnv } from "helium/server";

export default function HomePage() {
    const { data: serverEnv, isLoading } = useFetch(getServerEnv);

    const { data: clientIP } = useFetch(getIP);

    return (
        <div>
            <h1 className="text-3xl font-bold my-4">Welcome to HeliumJS</h1>
            <p className="mb-4 text-gray-600">A small and opinionated framework for building full-stack React applications</p>
            <ul className="list-disc list-inside space-y-2 text-gray-700">
                <li>File-based RPC framework: no REST, no fetch, no API routes</li>
                <li>Server functions live in src/server and are auto-scanned</li>
                <li>Pages live in src/pages and are file-based routes (NextJS page route style)</li>
                <li>Client imports server functions via virtual modules (helium/server)</li>
                <li>Communication happens over a persistent WebSocket RPC protocol</li>
                <li>Two hooks: useFetch (reactive reads) and useCall (imperative writes)</li>

                <li>Simple mental model: write a server function → import on client → call it</li>
            </ul>
            <div className="mt-8 p-4 bg-yellow-50 rounded-lg">
                <h2 className="text-xl font-semibold mb-2">Detected Client IP</h2>
                <p>{clientIP?.ip || "Loading..."}</p>
            </div>

            {/* Example of using environment variables in React */}
            <div className="mt-8 p-4 bg-blue-50 rounded-lg">
                <h2 className="text-xl font-semibold mb-2">Environment Variables Example</h2>
                <div className="space-y-1 text-sm">
                    <p>
                        <strong>App Name:</strong> {import.meta.env.HELIUM_PUBLIC_APP_NAME || "Not set"}
                    </p>
                    <p>
                        <strong>API URL:</strong> {import.meta.env.HELIUM_PUBLIC_API_URL || "Not set"}
                    </p>
                    <p>
                        <strong>Feature Flag:</strong> {import.meta.env.HELIUM_PUBLIC_FEATURE_FLAG || "Not set"}
                    </p>
                </div>
                <p className="text-xs text-gray-500 mt-2">Note: Only HELIUM_PUBLIC_ prefixed variables are accessible in the browser</p>
            </div>

            {/* Example of fetching server-side environment variables */}
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
                <h2 className="text-xl font-semibold mb-2">Server Environment Variables</h2>
                {isLoading ? (
                    <p className="text-sm text-gray-500">Loading...</p>
                ) : (
                    <div className="space-y-1 text-sm">
                        <p>
                            <strong>App Name (from server):</strong> {serverEnv?.appName}
                        </p>
                        <p>
                            <strong>API URL (from server):</strong> {serverEnv?.apiUrl}
                        </p>
                        <p>
                            <strong>Database URL (from server):</strong> {serverEnv?.databaseUrl}
                        </p>
                        <p>
                            <strong>Has API Secret:</strong> {serverEnv?.hasApiSecret ? "Yes" : "No"}
                        </p>
                    </div>
                )}
                <p className="text-xs text-gray-500 mt-2">These values are fetched from the server via RPC</p>
            </div>
        </div>
    );
}
