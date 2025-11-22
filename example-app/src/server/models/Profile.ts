import mongoose, { Document, Schema } from "mongoose";

export interface IProfile extends Document {
    name: string;
    email: string;
}

const profileSchema = new Schema<IProfile>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true },
    },
    {
        timestamps: true,
    }
);

export const ProfileModel = mongoose.models.Profile || mongoose.model<IProfile>("Profile", profileSchema, "Profile");
