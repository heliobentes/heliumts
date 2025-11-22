import { Link, useCall, useFetch } from "helium/client";
import { createTask, deleteTask, getTasks } from "helium/server";
import { useEffect, useState } from "react";

export default function TasksPage() {
    const [taskName, setTaskName] = useState("");

    const { data: tasks, isLoading } = useFetch(
        getTasks,
        {
            status: "open",
        },
        { ttl: 10 * 1000 /* 10 seconds cache */ }
    );

    const {
        call: addTask,
        isCalling,
        error: errorCreating,
        stats: statsCreating,
    } = useCall(createTask, {
        invalidate: [getTasks],
    });

    const { call: removeTask, isCalling: isDeleting } = useCall(deleteTask, {
        invalidate: [getTasks],
    });

    useEffect(() => {
        setTaskName(`Task ${tasks?.length || 0}`);
    }, [tasks]);

    return (
        <div>
            <h1 className="text-lg font-bold mb-4">Add a new Tasks</h1>

            <div className="flex items-center gap-4 mb-6">
                <input type="text" placeholder="Task name" value={taskName} className="input" onChange={(e) => setTaskName(e.target.value)} />

                <button onClick={() => addTask({ name: taskName })} disabled={isCalling} className="button primary">
                    {isCalling ? "Adding..." : "Add Task"}
                </button>
            </div>
            {errorCreating ? (
                <p className="text-red-500 mb-4">
                    Error creating task: {errorCreating}, try again in {statsCreating?.resetInSeconds as number} seconds.
                </p>
            ) : null}

            <h2 className="text-xl font-semibold mb-4">Open Tasks</h2>
            {isLoading && <p className="text-slate-400">Loading tasks...</p>}
            <div className="flex flex-col gap-2">
                {tasks?.map((task) => (
                    <Link key={task.id} href={`/tasks/${task.id}`} className="border border-gray-300 hover:shadow-lg p-3 rounded-lg bg-white flex justify-between items-center">
                        {task.name}

                        <button
                            onClick={async (e) => {
                                e.preventDefault();
                                await removeTask({ id: task.id });
                            }}
                            disabled={isDeleting}
                            className="text-red-500 hover:text-red-700"
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                    </Link>
                ))}
            </div>
        </div>
    );
}
