import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Monorepo: o .env vive na raiz do workspace, não neste pacote. Sem isto o
// Prisma CLI não enxerga DATABASE_URL quando rodado via turbo/pnpm --filter.
loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
});
