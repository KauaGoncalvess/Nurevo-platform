import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "segredo-de-teste-nao-usar-em-producao-000000";
process.env.APP_URL ??= "http://localhost:3000";

if (!process.env.DATABASE_URL_APP) {
  throw new Error(
    "DATABASE_URL_APP ausente. Copie .env.example para .env e rode pnpm db:migrate.",
  );
}
