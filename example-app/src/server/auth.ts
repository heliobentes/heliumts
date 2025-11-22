import { defineHTTPRequest } from "helium/server";

import { auth } from "../libs/better-auth/auth";

export const betterAuthHttp = defineHTTPRequest("ALL", "/api/auth/*", async (req, _ctx) => {
    // Call the better-auth handler directly
    const response = await auth.handler(await req.toWebRequest());

    // Return the response
    return response;
});
