import { Link, useFetch, useRouter } from "helium/client";
import { getTaskById } from "helium/server";
import { useEffect, useState } from "react";

type TaskDetailProps = {
    params: {
        id: string;
    };
};

export default function TaskDetailPage({ params }: TaskDetailProps) {
    const [enabled, setEnabled] = useState(false);

    const router = useRouter();

    const { data: task, isLoading } = useFetch(
        getTaskById,
        {
            id: params.id,
        },
        {
            enabled: enabled,
        }
    );

    useEffect(() => {
        const timeout = setTimeout(() => {
            setEnabled(true);
        }, 2000); // Enable fetching after 2000ms

        return () => clearTimeout(timeout);
    }, []);

    if (isLoading) {
        return (
            <div>
                <p className="text-gray-600">Loading task...</p>
            </div>
        );
    }

    if (!task) {
        if (enabled) {
            return (
                <div>
                    <h1 className="text-3xl font-bold mb-4">Task Not Found</h1>
                    <p className="mb-4">Task with ID {params.id} does not exist.</p>
                    <Link href="/tasks" className="text-teal-500 hover:text-teal-600">
                        ← Back to Tasks
                    </Link>
                </div>
            );
        } else {
            return (
                <div>
                    <h1 className="text-3xl font-bold mb-4">Delaying task load</h1>
                    <p className="mb-4">Task with ID {params.id} will load after 2000ms.</p>
                    <Link href="/tasks" className="text-teal-500 hover:text-teal-600">
                        ← Back to Tasks
                    </Link>
                </div>
            );
        }
    }

    return (
        <div>
            <h1 className="text-2xl font-bold mb-4">{task.name}</h1>
            <div className="space-y-4 bg-white p-4 border border-gray-300 rounded-lg">
                <div>
                    <span className="text-slate-400">Task ID:</span> <span className="font-mono">{params.id}</span>
                </div>
                <div>
                    <span className="text-slate-400">Status:</span> <span className="text-green-400 capitalize">{task.status}</span>
                </div>
                <div>
                    <span className="text-slate-400">Current Path:</span> <span className="font-mono">{router.path}</span>
                </div>
            </div>
            <div className="mt-6 space-x-4">
                <Link href="/tasks" className="text-teal-500 hover:text-teal-600">
                    ← Back to Tasks
                </Link>
            </div>
        </div>
    );
}
