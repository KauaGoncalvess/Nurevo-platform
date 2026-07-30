import boundaries from "eslint-plugin-boundaries";

/**
 * Enforcement das fronteiras do doc 02 — docs/engineering/02-modules-boundaries.md
 *
 * A regra não é cultural, é mecânica. Se este arquivo for afrouxado, o monolito
 * modular deixa de existir e ninguém percebe até ser tarde.
 *
 * Quatro tipos de elemento e as únicas dependências permitidas entre eles:
 *
 *   app             -> app, core, module-public     (composition root: main, app.module)
 *   core            -> core                          (NUNCA importa de modules)
 *   module-public   -> core, o interno do PRÓPRIO módulo
 *   module-internal -> core, module-public, o interno do PRÓPRIO módulo
 *
 * `no-unknown-files` fica LIGADO de propósito: arquivo solto fora da anatomia
 * do doc 02 quebra o CI em vez de virar um canto sem regra.
 *
 * @param {{ srcRoot?: string, tsconfigPath?: string }} options
 *   srcRoot é a pasta src relativa ao cwd do eslint. Parametrizado porque o
 *   eslint roda com cwd em apps/backend, mas o doc escreve os caminhos a partir
 *   da raiz do monorepo.
 */
export function createBoundariesConfig({
  srcRoot = "src",
  tsconfigPath = "./tsconfig.json",
} = {}) {
  return [
    {
      files: [`${srcRoot}/**/*.ts`],
      plugins: { boundaries },
      settings: {
        // Sem resolver de TS o plugin não resolve `../x/y` sem extensão, trata
        // todo import como "elemento desconhecido" e a regra passa batido —
        // enforcement que não enforça. Este bloco é o que faz a regra existir.
        "import/resolver": {
          typescript: { project: tsconfigPath },
        },
        "boundaries/include": [`${srcRoot}/**/*.ts`],
        "boundaries/elements": [
          // A ordem importa: boundaries casa o primeiro padrão que bater.
          {
            type: "app",
            pattern: `${srcRoot}/*.ts`,
            mode: "file",
          },
          {
            type: "core",
            pattern: `${srcRoot}/core/*`,
            capture: ["area"],
          },
          {
            type: "module-public",
            pattern: `${srcRoot}/modules/*/index.ts`,
            mode: "full",
            capture: ["module"],
          },
          {
            type: "module-internal",
            pattern: `${srcRoot}/modules/*`,
            capture: ["module"],
          },
        ],
      },
      rules: {
        "boundaries/no-unknown-files": "error",
        "boundaries/no-unknown": "error",
        "boundaries/element-types": [
          "error",
          {
            default: "disallow",
            message:
              "${file.type} não pode importar ${dependency.type}. Atravessar módulo é só pelo index.ts público (docs/engineering/02-modules-boundaries.md).",
            rules: [
              {
                // O composition root monta o grafo: enxerga core e a fachada
                // de cada módulo, e nada além disso.
                from: ["app"],
                allow: ["app", "core", "module-public"],
              },
              {
                from: ["core"],
                allow: ["core"],
              },
              {
                from: ["module-public"],
                allow: [
                  "core",
                  ["module-internal", { module: "${from.module}" }],
                ],
              },
              {
                from: ["module-internal"],
                allow: [
                  "core",
                  "module-public",
                  ["module-internal", { module: "${from.module}" }],
                ],
              },
            ],
          },
        ],
      },
    },

    /**
     * O client com BYPASSRLS existe para billing jobs e admin. Em qualquer outro
     * lugar ele é um bypass do isolamento entre tenants — ou seja, um incidente.
     */
    {
      files: [`${srcRoot}/**/*.ts`],
      ignores: [
        `${srcRoot}/modules/admin/**`,
        `${srcRoot}/modules/billing/jobs/**`,
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@nurevo/database",
                importNames: ["createAdminClient"],
                message:
                  "O client BYPASSRLS só é permitido em modules/admin e modules/billing/jobs. Use withTenant().",
              },
            ],
          },
        ],
      },
    },
  ];
}

export default createBoundariesConfig;
