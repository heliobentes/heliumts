import { Link } from "helium/client";

export default function ProfilePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Profile Settings</h1>
      <div className="space-y-4">
        <div className="border border-slate-700 p-4 rounded">
          <label className="block text-slate-400 mb-2">Name</label>
          <input
            type="text"
            defaultValue="John Doe"
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
          />
        </div>
        <div className="border border-slate-700 p-4 rounded">
          <label className="block text-slate-400 mb-2">Email</label>
          <input
            type="email"
            defaultValue="john@example.com"
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
          />
        </div>
        <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
          Save Changes
        </button>
      </div>
      <div className="mt-6">
        <Link href="/" className="text-slate-400 hover:text-slate-300">
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
