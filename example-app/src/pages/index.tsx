import { Link } from "helium/client";

export default function HomePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Welcome to Helium edited</h1>
      <p className="mb-4 text-slate-300">
        This is a file-based routing example using Helium framework.
      </p>
      <div className="space-y-2">
        <div>
          <Link
            href="/tasks"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            View Tasks
          </Link>
        </div>
        <div>
          <Link
            href="/settings/profile"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            Go to Profile Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
