import { useCall, useFetch } from "helium/client";
import { createTask, getTasks } from "helium/server";
import { useEffect, useState } from "react";
import type { Task } from "./server/tasks/tasksStore";

export default function App() {
  const [taskName, setTaskName] = useState("");

  const { data: tasks, isLoading } = useFetch<{ status?: string }, Task[]>(
    getTasks,
    { status: "open" }
  );

  const { call: addTask, isCalling } = useCall(createTask, {
    invalidate: [getTasks],
  });

  useEffect(() => {
    setTaskName(`Task ${tasks?.length}`);
  }, [tasks]);

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-4">HeliumJS Example App</h1>

      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Task name"
          id="taskNameInput"
          value={taskName}
          className="border border-gray-300 rounded-lg px-4 py-2 inset-shadow-xs bg-white"
          onChange={(e) => setTaskName(e.target.value)}
        />

        <button
          onClick={() => addTask({ name: taskName })}
          disabled={isCalling}
          className="bg-teal-500 text-shadow-sm text-shadow-teal-600/70 text-white transition-colors px-4 py-1.5 cursor-pointer rounded-lg hover:bg-teal-600 disabled:opacity-50 border border-b-4 border-r-4 border-teal-700"
        >
          Add Task
        </button>
      </div>

      <h2 className="text-xl font-semibold mt-8">Open Tasks</h2>
      {isLoading && <p>Loading tasks...</p>}
      <ul className="mt-6 flex flex-col gap-4 max-w-lg">
        {tasks?.map((t: Task) => (
          <li
            key={t.id}
            className="border border-gray-300 p-4 rounded-lg bg-white hover:shadow-md cursor-pointer"
          >
            {t.name}{" "}
          </li>
        ))}
      </ul>
    </div>
  );
}
