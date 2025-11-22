/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly HELIUM_PUBLIC_APP_NAME: string;
    readonly HELIUM_PUBLIC_API_URL: string;
    readonly HELIUM_PUBLIC_FEATURE_FLAG: string;
    // Add more env variables as needed
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
