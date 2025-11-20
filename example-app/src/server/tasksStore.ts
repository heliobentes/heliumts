export type Task = {
  id: number;
  name: string;
  status: "open" | "done";
};

const STORE_KEY = "__helium_tasksStore";
const COUNTER_KEY = "__helium_tasksCounter";
const globalAny = globalThis as Record<string, unknown>;

if (!globalAny[STORE_KEY]) {
  globalAny[STORE_KEY] = [
    { id: 1, name: "Task A", status: "open" },
    { id: 2, name: "Task B", status: "done" },
  ] satisfies Task[];
}

export const tasksStore = globalAny[STORE_KEY] as Task[];

if (typeof globalAny[COUNTER_KEY] !== "number") {
  const nextId =
    tasksStore.reduce((max, task) => Math.max(max, task.id), 0) + 1;
  globalAny[COUNTER_KEY] = nextId;
}

export function nextTaskId(): number {
  const current = globalAny[COUNTER_KEY] as number;
  globalAny[COUNTER_KEY] = current + 1;
  return current;
}
