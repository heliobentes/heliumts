import { defineMethod } from "../../../heliumjs/dist/server";
import { tasksStore } from "./tasksStore";

export const getTasks = defineMethod(
  "getTasks",
  async (args?: { status?: string }) => {
    const status = args?.status;
    const results = status
      ? tasksStore.filter((t) => t.status === status)
      : tasksStore;
    return results.slice();
  }
);
