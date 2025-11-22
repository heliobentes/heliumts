import { type AppShellProps } from "helium/client";

export default function App({ Component, pageProps }: AppShellProps) {
    return <Component {...pageProps} />;
}
