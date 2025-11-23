"use ssg";

import HeliumLogo from "../../components/Logo";

export default function AboutPage() {
    return (
        <div>
            <HeliumLogo />
            <h1>About Helium</h1>
            <p>This page is statically generated at build time for better SEO!</p>
            <p>Helium is a full-stack React framework with RPC-style server functions.</p>
        </div>
    );
}
