import mongoose, { Document, Schema } from "mongoose";

export interface ITask extends Document {
    name: string;
    status: "open" | "done";
}

const taskSchema = new Schema<ITask>(
    {
        name: { type: String, required: true },
        status: { type: String, enum: ["open", "done"], default: "open" },
    },
    {
        timestamps: true,
    }
);

export const TaskModel = mongoose.models.Task || mongoose.model<ITask>("Task", taskSchema, "Task");
