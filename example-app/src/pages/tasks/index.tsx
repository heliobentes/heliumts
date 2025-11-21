import { useEffect, useState } from "react";

import { Link, useCall, useFetch } from "helium/client";
import { createTask, getTasks } from "helium/server";
import type { Task } from "../../server/tasks/tasksStore";

export default function TasksPage() {
  const [taskName, setTaskName] = useState("");

  const { data: tasks, isLoading } = useFetch<{ status?: string }, Task[]>(
    getTasks,
    {
      status: "open",
    }
  );

  const { call: addTask, isCalling } = useCall(createTask, {
    invalidate: [getTasks],
  });

  useEffect(() => {
    setTaskName(`Task ${tasks?.length || 0}`);
  }, [tasks]);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Tasks</h1>

      <div className="flex items-center gap-4 mb-6">
        <input
          type="text"
          placeholder="Task name"
          value={taskName}
          className="border border-slate-600 rounded-lg px-4 py-2 bg-slate-800 text-slate-100"
          onChange={(e) => setTaskName(e.target.value)}
        />

        <button
          onClick={() => addTask({ name: taskName })}
          disabled={isCalling}
          className="bg-teal-500 text-white transition-colors px-4 py-2 cursor-pointer rounded-lg hover:bg-teal-600 disabled:opacity-50"
        >
          {isCalling ? "Adding..." : "Add Task"}
        </button>
      </div>

      <h2 className="text-xl font-semibold mb-4">Open Tasks</h2>
      {isLoading && <p className="text-slate-400">Loading tasks...</p>}
      <div className="space-y-2">
        {tasks?.map((task) => (
          <div
            key={task.id}
            className="border border-slate-700 p-3 rounded bg-slate-800"
          >
            <Link
              href={`/tasks/${task.id}`}
              className="text-blue-400 hover:text-blue-300"
            >
              {task.name}
            </Link>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Link href="/" className="text-slate-400 hover:text-slate-300">
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}
