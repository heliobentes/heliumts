import { Link, useRouter } from "helium/client";

export default function DynamicSlugPage({ params }: { params: { slug: string[] } }) {
    const router = useRouter();

    // Check if this is a catch-all route handling a 404
    if (router.status === 404) {
        return (
            <div className="text-center py-12">
                <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
                <p className="text-gray-600 mb-4">
                    The path <strong>/{params.slug.join("/")}</strong> does not exist.
                </p>
                <Link href="/" className="text-blue-500 hover:underline">
                    Return to Home
                </Link>
            </div>
        );
    }

    // This is a valid route - show actual content
    return (
        <div>
            <h1 className="text-3xl font-bold mb-4">Dynamic Slug Page</h1>
            <p className="text-gray-600 mb-4">
                You are viewing the page for slug: <strong>{params.slug.join(" / ")}</strong>
            </p>
            <p className="text-sm text-gray-500">
                Route Status: <span className="font-mono">{router.status}</span>
            </p>
        </div>
    );
}
