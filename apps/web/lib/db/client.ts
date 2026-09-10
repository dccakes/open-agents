import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseConfig } from "@/lib/config/db";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleClient | null = null;

export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!_db) {
      const { url } = getDatabaseConfig();
      if (!url) {
        throw new Error("POSTGRES_URL environment variable is required");
      }
      const client = postgres(url);
      _db = drizzle(client, { schema });
    }
    return Reflect.get(_db, prop);
  },
});
