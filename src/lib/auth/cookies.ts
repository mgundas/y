/**
 * Better Auth's session cookie name.
 *
 * Lives in its own module with no `server-only` marker because `src/proxy.ts`
 * needs it and Proxy cannot import server modules. The value is just a
 * string, so sharing it is safe - but keep it that way: nothing that touches
 * the database or secrets may move in here.
 */
export const SESSION_COOKIE = "better-auth.session_token";
