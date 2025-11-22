import { Link } from "helium/client";

export default function NotFoundPage() {
    return (
        <div className="text-center py-12">
            <h1 className="text-6xl font-bold mb-4">404</h1>
            <p className="text-2xl mb-8 text-slate-300">Page Not Found</p>
            <p className="mb-8 text-slate-400">The page you're looking for doesn't exist or has been moved.</p>
            <Link href="/" className="text-blue-400 hover:text-blue-300 underline text-lg">
                Return to Home
            </Link>
        </div>
    );
}
