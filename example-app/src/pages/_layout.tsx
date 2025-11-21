import type { LayoutProps } from "helium/client";
import { Link } from "helium/client";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-300">
        <div className="max-w-4xl mx-auto p-4">
          <h1 className="text-xl font-bold">Helium Example App</h1>
          <nav className="mt-2 space-x-4">
            <Link href="/" className="text-blue-700 hover:text-blue-900">
              Home
            </Link>
            <Link href="/tasks" className="text-blue-700 hover:text-blue-900">
              Tasks
            </Link>
            <Link
              href="/settings/profile"
              className="text-blue-700 hover:text-blue-900"
            >
              Profile
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-4">{children}</main>
    </div>
  );
}
