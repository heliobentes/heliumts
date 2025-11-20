import { useCall, useFetch } from "../../heliumjs/dist/client";
import { createTask } from "./server/createTask";
import { getTasks } from "./server/getTasks";
import type { Task } from "./server/tasksStore";

export default function App() {
  const { data: tasks, isLoading } = useFetch<{ status?: string }, Task[]>(
    getTasks,
    { status: "open" }
  );

  const { call: addTask, isCalling } = useCall(createTask, {
    invalidate: [getTasks],
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>HeliumJS Example App</h1>

      <button
        onClick={() => addTask({ name: "New task " + tasks?.length })}
        disabled={isCalling}
      >
        Add Task
      </button>

      <ul>
        {tasks?.map((t: Task) => (
          <li key={t.id}>{t.name}</li>
        ))}
      </ul>
    </div>
  );
}
