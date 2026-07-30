import { baseConfig } from "@nurevo/eslint-config";
import { createBoundariesConfig } from "@nurevo/eslint-config/boundaries";

export default [
  ...baseConfig,
  // O eslint roda com cwd em apps/backend, então src é a raiz dos padrões.
  ...createBoundariesConfig({ srcRoot: "src" }),
  {
    files: ["src/**/*.ts"],
    rules: {
      // Os decorators do Nest precisam do tipo em runtime para injeção de
      // dependência; forçar `import type` em tudo quebraria o DI.
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
];
