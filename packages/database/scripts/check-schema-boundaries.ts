import fs from "node:fs";
import path from "node:path";

/**
 * Fronteira de dados entre módulos — doc 02, regra 2.
 *
 * O Prisma gera UM client a partir de todos os .prisma. Ou seja, o banco não
 * impede um `include` cruzando domínios, e a fronteira do doc 02 seria só uma
 * boa intenção. Este script é o que a torna real.
 *
 * Proibido: um modelo de `organizations` declarar @relation para um modelo de
 * `identity`. Referência entre módulos se representa por uuid puro, resolvida
 * por serviço público. É isso que mantém a extração possível — e o que impede
 * um JOIN silencioso de amarrar dois domínios para sempre.
 *
 * Rode no CI: pnpm --filter @nurevo/database check:boundaries
 */

const SCHEMA_DIR = path.resolve(process.cwd(), "prisma/schema");
const IGNORED = new Set(["base.prisma"]);

interface Declaration {
  name: string;
  module: string;
  body: string;
}

function parse(): Declaration[] {
  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma") && !IGNORED.has(f));

  const declarations: Declaration[] = [];

  for (const file of files) {
    const module = path.basename(file, ".prisma");
    const source = fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8");
    const re = /^(model|enum)\s+(\w+)\s*\{([^}]*)\}/gms;

    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      declarations.push({ name: match[2]!, module, body: match[3]! });
    }
  }

  return declarations;
}

function main(): void {
  const declarations = parse();
  const moduleOf = new Map(declarations.map((d) => [d.name, d.module]));
  const violations: string[] = [];

  for (const decl of declarations) {
    for (const rawLine of decl.body.split("\n")) {
      const line = rawLine.trim();
      // Só campos: pula comentários, atributos de bloco e linhas vazias.
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;

      const parts = line.split(/\s+/);
      const type = parts[1]?.replace(/\[\]$/, "").replace(/\?$/, "");
      if (!type) continue;

      const target = moduleOf.get(type);
      if (target && target !== decl.module) {
        violations.push(
          `  ${decl.module}.${decl.name}.${parts[0]} -> ${target}.${type}`,
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "Relação entre módulos detectada no schema Prisma (doc 02, regra 2):\n" +
        violations.join("\n") +
        "\n\nUse uuid puro, sem @relation, e resolva pelo serviço público do módulo.",
    );
    process.exit(1);
  }

  console.warn(
    `Fronteira de dados OK: ${declarations.length} declarações em ${
      new Set(declarations.map((d) => d.module)).size
    } módulos, nenhuma relação cruzada.`,
  );
}

main();
