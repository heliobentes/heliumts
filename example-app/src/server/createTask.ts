import { defineMethod } from "../../../heliumjs/dist/server";
import { nextTaskId, tasksStore } from "./tasksStore";

export const createTask = defineMethod(
  "createTask",
  async (args: { name: string }) => {
    const task = { id: nextTaskId(), name: args.name, status: "open" as const };
    tasksStore.push(task);
    return task;
  }
);
