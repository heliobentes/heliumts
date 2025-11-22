import { defineMethod } from "helium/server";

export const getServerEnv = defineMethod(async () => {
    // Server-side environment variables are accessible via process.env
    // Both HELIUM_PUBLIC_ prefixed and non-prefixed variables are available here
    const env: Record<string, string | boolean> = {
        appName: process.env.HELIUM_PUBLIC_APP_NAME || "Not set",
        apiUrl: process.env.HELIUM_PUBLIC_API_URL || "Not set",
        // Server-only variables (not prefixed with VITE_)
        databaseUrl: process.env.DATABASE_URL || "Not set",
        hasApiSecret: !!process.env.API_SECRET_KEY,
    };
    return env;
});
