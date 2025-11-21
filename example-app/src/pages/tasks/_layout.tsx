import type { LayoutProps } from "helium/client";
import { Link } from "helium/client";

export default function TasksLayout({ children }: LayoutProps) {
  return (
    <div className="border border-slate-700 rounded-lg p-6">
      <div className="mb-4 pb-4 border-b border-slate-700">
        <h2 className="text-2xl font-bold text-blue-400">Tasks Section</h2>
        <p className="text-slate-400 text-sm mt-1">
          This layout wraps all pages in /tasks/*
        </p>
        <nav className="mt-3 space-x-3">
          <Link href="/tasks" className="text-blue-400 hover:text-blue-300">
            All Tasks
          </Link>
          <Link href="/" className="text-slate-400 hover:text-slate-300">
            Home
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
