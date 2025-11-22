import { defineMethod } from "helium/server";

import { Task } from "../../types/task";
import { TaskModel } from "../models/Task";

export const getTasks = defineMethod(async (args?: { status?: string }) => {
    const filter = args?.status ? { status: args.status } : {};
    const tasks = await TaskModel.find(filter).sort({ createdAt: -1 });

    return tasks.map((task) => ({
        id: task._id.toString(),
        name: task.name,
        status: task.status,
    })) as Task[];
});

export const getTaskById = defineMethod(async (args: { id: string }) => {
    const task = await TaskModel.findById(args.id);

    if (!task) {
        return null;
    }

    return {
        id: task._id.toString(),
        name: task.name,
        status: task.status,
    } as Task;
});

export const createTask = defineMethod(async (args: { name: string }) => {
    const task = await TaskModel.create({
        name: args.name,
        status: "open",
    });

    return {
        id: task._id.toString(),
        name: task.name,
        status: task.status,
    } as Task;
});

export const deleteTask = defineMethod(async (args: { id: string }) => {
    const result = await TaskModel.findByIdAndDelete(args.id);

    if (result) {
        return { success: true };
    } else {
        return { success: false, message: "Task not found" };
    }
});

export const editTask = defineMethod(async (args: { id: string; name?: string; status?: string }) => {
    const task = await TaskModel.findById(args.id);

    if (!task) {
        return { success: false, message: "Task not found" };
    }

    if (args.name !== undefined) {
        task.name = args.name;
    }
    if (args.status !== undefined) {
        task.status = args.status as "open" | "done";
    }

    await task.save();

    return {
        success: true,
        task: {
            _id: task._id,
            id: task._id.toString(),
            name: task.name,
            status: task.status,
        } as Task,
    };
});
