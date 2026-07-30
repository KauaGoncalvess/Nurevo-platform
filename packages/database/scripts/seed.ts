import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createAdminClient, createAppClient, forTenant } from "../src";

loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

/**
 * Seed do catálogo global + (opcional) um tenant de demonstração.
 *
 * Por que o catálogo usa o client ADMIN e não o da aplicação:
 * roles de sistema têm organization_id NULL, e o WITH CHECK da política exige
 * `organization_id = current_organization_id()`. NULL nunca satisfaz isso — nem
 * para o owner, porque as tabelas estão em FORCE ROW LEVEL SECURITY.
 *
 * Isso não é um obstáculo, é a política funcionando: um tenant não pode fabricar
 * role de sistema. Semear catálogo global é justamente uma das operações
 * legítimas de plataforma que o role BYPASSRLS existe para fazer.
 */

const PERMISSIONS = [
  ["organizations:read", "organizations", "Ver dados da empresa"],
  ["organizations:write", "organizations", "Editar dados da empresa"],
  ["members:read", "organizations", "Ver membros"],
  ["members:write", "organizations", "Convidar e remover membros"],
  ["branches:read", "organizations", "Ver filiais"],
  ["branches:write", "organizations", "Criar e editar filiais"],
  ["billing:read", "billing", "Ver assinatura e faturas"],
  ["billing:write", "billing", "Alterar plano e pagamento"],
  ["customers:read", "crm", "Ver clientes"],
  ["customers:write", "crm", "Criar e editar clientes"],
  ["appointments:read", "tattoo", "Ver agenda"],
  ["appointments:write", "tattoo", "Criar e alterar agendamentos"],
] as const;

const SYSTEM_ROLES = [
  { key: "owner", name: "Proprietário", permissions: "*" },
  {
    key: "admin",
    name: "Administrador",
    permissions: PERMISSIONS.map(([k]) => k).filter(
      (k) => !k.startsWith("billing:write"),
    ),
  },
  {
    key: "staff",
    name: "Equipe",
    permissions: [
      "customers:read",
      "customers:write",
      "appointments:read",
      "appointments:write",
      "branches:read",
    ],
  },
  {
    key: "viewer",
    name: "Somente leitura",
    permissions: PERMISSIONS.map(([k]) => k).filter((k) => k.endsWith(":read")),
  },
] as const;

async function seedCatalog(): Promise<void> {
  const admin = createAdminClient();

  try {
    for (const [key, moduleKey, description] of PERMISSIONS) {
      await admin.permission.upsert({
        where: { key },
        create: { key, moduleKey, description },
        update: { moduleKey, description },
      });
    }

    for (const role of SYSTEM_ROLES) {
      const existing = await admin.role.findFirst({
        where: { key: role.key, organizationId: null },
      });

      const saved =
        existing ??
        (await admin.role.create({
          data: { key: role.key, name: role.name, isSystem: true },
        }));

      const keys =
        role.permissions === "*"
          ? PERMISSIONS.map(([k]) => k)
          : [...role.permissions];

      const permissions = await admin.permission.findMany({
        where: { key: { in: keys } },
      });

      await admin.rolePermission.createMany({
        data: permissions.map((p) => ({
          roleId: saved.id,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
    }

    console.warn(
      `Catálogo: ${PERMISSIONS.length} permissões, ${SYSTEM_ROLES.length} roles de sistema.`,
    );
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Tenant de demonstração, criado pelo caminho REAL da aplicação: id gerado
 * antes, transação já fixada nesse tenant. Nenhum bypass.
 */
async function seedDemoTenant(): Promise<void> {
  const prisma = createAppClient();

  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT uuid_generate_v7() AS id
    `;
    const id = rows[0]!.id;

    await forTenant(prisma, id, async (tx) => {
      const existing = await tx.organization.findFirst({
        where: { slug: "estudio-demo" },
      });
      if (existing) {
        console.warn("Tenant de demonstração já existe, nada a fazer.");
        return;
      }

      await tx.organization.create({
        data: {
          id,
          slug: "estudio-demo",
          legalName: "Estúdio Demo LTDA",
          tradeName: "Estúdio Demo",
          status: "trialing",
        },
      });

      await tx.branch.create({
        data: { organizationId: id, name: "Unidade Centro", isDefault: true },
      });

      console.warn(`Tenant de demonstração criado: ${id}`);
      console.warn(`  curl -H "x-organization-id: ${id}" localhost:3333/branches`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  await seedCatalog();
  if (process.env.SEED_DEMO === "true") {
    await seedDemoTenant();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
