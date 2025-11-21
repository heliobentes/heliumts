import { Link, useFetch, useRouter } from "helium/client";
import { getTasks } from "helium/server";
import type { Task } from "../../server/tasks/tasksStore";

type TaskDetailProps = {
  params: {
    id: string;
  };
};

export default function TaskDetailPage({ params }: TaskDetailProps) {
  const router = useRouter();

  const { data: tasks, isLoading } = useFetch<{ status?: string }, Task[]>(
    getTasks,
    {
      status: "open",
    }
  );

  const task = tasks?.find((t) => t.id === Number(params.id));

  if (isLoading) {
    return (
      <div>
        <p className="text-slate-400">Loading task...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-4">Task Not Found</h1>
        <p className="mb-4">Task with ID {params.id} does not exist.</p>
        <Link href="/tasks" className="text-blue-400 hover:text-blue-300">
          ← Back to Tasks
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">{task.name}</h1>
      <div className="space-y-4">
        <div>
          <span className="text-slate-400">Task ID:</span>{" "}
          <span className="font-mono">{params.id}</span>
        </div>
        <div>
          <span className="text-slate-400">Status:</span>{" "}
          <span className="text-green-400 capitalize">{task.status}</span>
        </div>
        <div>
          <span className="text-slate-400">Current Path:</span>{" "}
          <span className="font-mono">{router.path}</span>
        </div>
      </div>
      <div className="mt-6 space-x-4">
        <Link href="/tasks" className="text-blue-400 hover:text-blue-300">
          ← Back to Tasks
        </Link>
        <button
          onClick={() => router.push("/")}
          className="text-slate-400 hover:text-slate-300"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
