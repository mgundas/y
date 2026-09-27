import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/server";

// Handles every /api/auth/* route: sign-up, sign-in, sign-out, session.
export const { GET, POST } = toNextJsHandler(auth);
