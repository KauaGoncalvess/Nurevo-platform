import path from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // O Vitest transforma com esbuild, que NÃO implementa emitDecoratorMetadata.
  // Sem esses metadados o Nest não consegue resolver as dependências pelo tipo
  // do construtor, e todo teste morre no boot da aplicação. O SWC emite.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["tests/**/*.spec.ts"],
    setupFiles: [path.resolve(__dirname, "tests/setup.ts")],
    // Os testes compartilham um banco real e um pool. Paralelismo aqui produz
    // falha intermitente justamente na área onde não se pode ter dúvida.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
