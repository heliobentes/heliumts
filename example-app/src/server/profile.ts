import { defineMethod } from "helium/server";

const profile = {
    name: "John Doe",
    email: "john@example.com",
};

export const getProfile = defineMethod(async () => {
    return { ...profile };
});

export const updateProfile = defineMethod(async (args: { name?: string; email?: string }) => {
    if (args.name !== undefined) {
        profile.name = args.name;
    }
    if (args.email !== undefined) {
        profile.email = args.email;
    }
    return { ...profile };
});
