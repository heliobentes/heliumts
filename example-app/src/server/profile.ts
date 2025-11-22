import { defineMethod } from "helium/server";

import { Profile } from "../types/profile";
import { ProfileModel } from "./models/Profile";

export const getProfile = defineMethod(async (_args: null, _ctx) => {
    // Get or create the profile (single profile in this example)
    let profile = await ProfileModel.findOne();

    if (!profile) {
        // Create a default profile if none exists
        profile = await ProfileModel.create({
            name: "John Doe",
            email: "john@example.com",
        });
    }

    return {
        id: profile._id.toString(),
        name: profile.name,
        email: profile.email,
    } as Profile;
});

export const updateProfile = defineMethod(async (args: { name?: string; email?: string }) => {
    // Get or create the profile
    let profile = await ProfileModel.findOne();

    if (!profile) {
        profile = await ProfileModel.create({
            name: args.name || "John Doe",
            email: args.email || "john@example.com",
        });
    } else {
        // Update the profile
        if (args.name !== undefined) {
            profile.name = args.name;
        }
        if (args.email !== undefined) {
            profile.email = args.email;
        }
        await profile.save();
    }

    return {
        id: profile._id.toString(),
        name: profile.name,
        email: profile.email,
    } as Profile;
});
