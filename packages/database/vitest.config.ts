import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    // RLS é estado de conexão. Testes em paralelo compartilhando o pool tornam
    // falhas não determinísticas — justamente na área onde não se pode ter dúvida.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
