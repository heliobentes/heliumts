import type { LayoutProps } from "helium/client";

export default function TasksLayout({ children }: LayoutProps) {
    return (
        <div className="">
            <div className="mb-4 pb-4 border-b border-gray-300">
                <h2 className="text-2xl font-bold text-teal-600">Tasks</h2>
                <p className="text-gray-600 text-sm mt-1">This layout wraps all pages in /tasks/*</p>
            </div>
            {children}
        </div>
    );
}
