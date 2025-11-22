import { defineHTTPRequest } from "helium/server";

import { auth } from "../libs/better-auth/auth";

export const betterAuthHttp = defineHTTPRequest("ALL", "/api/auth/*", async (req, _ctx) => {
    // Call the better-auth handler directly
    return auth.handler(await req.toWebRequest());
});
