import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

if (!process.env.DATABASE_URL_APP) {
  throw new Error(
    "DATABASE_URL_APP ausente. Copie .env.example para .env e rode pnpm db:migrate.",
  );
}
