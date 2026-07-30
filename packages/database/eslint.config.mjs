import { baseConfig } from "@nurevo/eslint-config";

export default [
  ...baseConfig,
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      // Scripts e testes falam com o operador pelo stdout.
      "no-console": "off",
    },
  },
];
