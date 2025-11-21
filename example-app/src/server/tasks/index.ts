import { defineMethod } from "helium/server";
import { nextTaskId, tasksStore } from "./tasksStore";

export const getTasks = defineMethod(async (args?: { status?: string }) => {
  const status = args?.status;
  const results = status
    ? tasksStore.filter((t) => t.status === status)
    : tasksStore;
  return results.slice();
});

export const createTask = defineMethod(async (args: { name: string }) => {
  const task = { id: nextTaskId(), name: args.name, status: "open" as const };
  tasksStore.push(task);
  return task;
});
