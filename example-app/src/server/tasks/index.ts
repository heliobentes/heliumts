import { defineMethod } from "helium/server";

import { nextTaskId, tasksStore } from "./tasksStore";

export const getTasks = defineMethod(async (args?: { status?: string }) => {
    const status = args?.status;
    const results = status ? tasksStore.filter((t) => t.status === status) : tasksStore;
    return results.slice();
});

export const createTask = defineMethod(async (args: { name: string }) => {
    const task = { id: nextTaskId(), name: args.name, status: "open" as const };
    tasksStore.push(task);
    return task;
});

export const deleteTask = defineMethod(async (args: { id: number }) => {
    const index = tasksStore.findIndex((t) => t.id === args.id);
    if (index !== -1) {
        tasksStore.splice(index, 1);
        return { success: true };
    } else {
        return { success: false, message: "Task not found" };
    }
});

export const editTask = defineMethod(async (args: { id: number; name?: string; status?: string }) => {
    const task = tasksStore.find((t) => t.id === args.id);
    if (!task) {
        return { success: false, message: "Task not found" };
    }
    if (args.name !== undefined) {
        task.name = args.name;
    }
    if (args.status !== undefined) {
        task.status = args.status as any;
    }
    return { success: true, task };
});
