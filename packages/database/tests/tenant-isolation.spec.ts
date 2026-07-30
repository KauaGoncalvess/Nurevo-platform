import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAppClient, forTenant } from "../src";

/**
 * Os 5 testes de isolamento do doc 01.
 *
 * Estes testes bloqueiam merge. Não são testes de feature — são a prova de que
 * uma empresa não enxerga o dado de outra. Se algum ficar vermelho, nada mais
 * importa até ele voltar ao verde.
 *
 * Todos rodam contra o role `nurevo_app`, o mesmo que a aplicação usa em
 * produção. Rodar como owner ou superuser invalidaria o exercício inteiro.
 */

let prisma: PrismaClient;
let orgA: string;
let orgB: string;

const run = Date.now();

async function newId(client: PrismaClient): Promise<string> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT uuid_generate_v7() AS id
  `;
  return rows[0]!.id;
}

/**
 * Cria um tenant usando o próprio caminho da aplicação: id gerado antes,
 * transação já fixada nesse tenant. É assim que o onboarding real funciona —
 * o WITH CHECK da política exige que a linha nasça carimbada com o tenant atual.
 */
async function seedOrganization(name: string): Promise<string> {
  const id = await newId(prisma);

  await forTenant(prisma, id, async (tx) => {
    await tx.organization.create({
      data: { id, slug: `${name}-${run}`, legalName: `${name} LTDA` },
    });
    await tx.branch.create({
      data: { organizationId: id, name: `Unidade ${name}`, isDefault: true },
    });
  });

  return id;
}

beforeAll(async () => {
  prisma = createAppClient();
  orgA = await seedOrganization("estudio-a");
  orgB = await seedOrganization("estudio-b");
});

afterAll(async () => {
  for (const id of [orgA, orgB]) {
    if (!id) continue;
    await forTenant(prisma, id, async (tx) => {
      await tx.branch.deleteMany({});
      await tx.organization.deleteMany({});
    });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("1. cobertura de RLS", () => {
  it("toda tabela com organization_id tem RLS habilitado E forçado", async () => {
    // Pega a migration que criou tabela e esqueceu o bloco de política. Sem este
    // teste, o furo só aparece quando um cliente vê o dado de outro.
    const gaps = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'organization_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    `;

    expect(gaps.map((g) => g.table_name)).toEqual([]);
  });

  it("organizations, que isola por id e não por organization_id, também tem RLS forçado", async () => {
    const rows = await prisma.$queryRaw<
      { rls: boolean; forced: boolean }[]
    >`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'organizations'
    `;

    expect(rows[0]).toEqual({ rls: true, forced: true });
  });

  it("nenhuma tabela tem RLS habilitado sem política", async () => {
    // RLS ligado sem política nega tudo. É seguro, mas quebra a aplicação de um
    // jeito confuso — melhor pegar aqui.
    const orphans = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    `;

    expect(orphans.map((o) => o.table_name)).toEqual([]);
  });

  it("o role da aplicação não tem BYPASSRLS nem SUPERUSER", async () => {
    // Toda a proteção acima depende disto. Um GRANT bem-intencionado para
    // "resolver um erro de permissão" desliga o isolamento inteiro em silêncio.
    const rows = await prisma.$queryRaw<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `;

    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });
});

describe("2. isolamento de leitura", () => {
  it("um findMany sem where devolve apenas o tenant corrente", async () => {
    const fromA = await forTenant(prisma, orgA, (tx) => tx.branch.findMany());
    const fromB = await forTenant(prisma, orgB, (tx) => tx.branch.findMany());

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0]!.organizationId).toBe(orgA);
    expect(fromB[0]!.organizationId).toBe(orgB);
  });

  it("buscar pelo id de outro tenant devolve null, não o registro", async () => {
    const branchB = await forTenant(prisma, orgB, (tx) =>
      tx.branch.findFirstOrThrow(),
    );

    const stolen = await forTenant(prisma, orgA, (tx) =>
      tx.branch.findUnique({ where: { id: branchB.id } }),
    );

    // Conhecer o uuid não dá acesso. O isolamento não depende de a chave ser secreta.
    expect(stolen).toBeNull();
  });
});

describe("3. isolamento de escrita", () => {
  it("inserir carimbando o organization_id de outro tenant é rejeitado", async () => {
    // Este é o caso que USING não pega e só o WITH CHECK barra.
    await expect(
      forTenant(prisma, orgA, (tx) =>
        tx.branch.create({
          data: { organizationId: orgB, name: "filial intrusa" },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("update sem where não alcança linha de outro tenant", async () => {
    const result = await forTenant(prisma, orgA, (tx) =>
      tx.branch.updateMany({ data: { phone: "11999999999" } }),
    );

    expect(result.count).toBe(1);

    const untouched = await forTenant(prisma, orgB, (tx) =>
      tx.branch.findFirstOrThrow(),
    );
    expect(untouched.phone).toBeNull();
  });

  it("delete sem where não alcança linha de outro tenant", async () => {
    const result = await forTenant(prisma, orgA, (tx) =>
      tx.branch.deleteMany({ where: { name: "nao-existe" } }),
    );
    expect(result.count).toBe(0);

    const stillThere = await forTenant(prisma, orgB, (tx) =>
      tx.branch.count(),
    );
    expect(stillThere).toBe(1);
  });
});

describe("4. falha fechada", () => {
  it("query sem tenant setado devolve zero linhas, nunca tudo", async () => {
    // A propriedade mais importante do desenho: esquecer forTenant() gera um bug
    // visível (lista vazia) em vez de um incidente invisível (dados de todos).
    const branches = await prisma.branch.findMany();
    const orgs = await prisma.organization.findMany();

    expect(branches).toEqual([]);
    expect(orgs).toEqual([]);
  });

  it("insert sem tenant setado é rejeitado", async () => {
    await expect(
      prisma.branch.create({ data: { organizationId: orgA, name: "orfa" } }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("current_organization_id() é NULL fora de forTenant", async () => {
    const rows = await prisma.$queryRaw<{ org: string | null }[]>`
      SELECT current_organization_id() AS org
    `;
    expect(rows[0]!.org).toBeNull();
  });
});

describe("5. não vazamento entre requisições na mesma conexão", () => {
  it("o tenant não sobrevive ao fim da transação", async () => {
    // connection_limit=1 força TODAS as queries a compartilharem uma única
    // conexão física — exatamente o cenário que um pool cria em produção sob
    // carga. Se set_config fosse SET em vez de SET LOCAL, o teste abaixo pegaria
    // o tenant anterior grudado na conexão.
    const url = new URL(process.env.DATABASE_URL_APP!);
    url.searchParams.set("connection_limit", "1");
    const single = createAppClient(url.toString());

    try {
      const first = await forTenant(single, orgA, (tx) => tx.branch.findMany());
      expect(first).toHaveLength(1);
      expect(first[0]!.organizationId).toBe(orgA);

      // Mesma conexão, tenant diferente: não pode herdar nada do anterior.
      const second = await forTenant(single, orgB, (tx) => tx.branch.findMany());
      expect(second).toHaveLength(1);
      expect(second[0]!.organizationId).toBe(orgB);

      // E, fora de transação, a conexão volta a não ter tenant nenhum.
      const leaked = await single.$queryRaw<{ org: string | null }[]>`
        SELECT current_organization_id() AS org
      `;
      expect(leaked[0]!.org).toBeNull();

      const afterAllTx = await single.branch.findMany();
      expect(afterAllTx).toEqual([]);
    } finally {
      await single.$disconnect();
    }
  });
});
