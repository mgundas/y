import { defineConfig } from "drizzle-kit";

// drizzle-kit is loaded by esbuild and does not reliably pick up .env across
// versions, so load it explicitly. process.loadEnvFile exists on Node >= 20.12.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env present - fall back to whatever is already in the environment
  // (CI, or a manually exported DATABASE_URL).
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "No database connection string found. Set DATABASE_URL (or DATABASE_URL_DIRECT) in .env.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
