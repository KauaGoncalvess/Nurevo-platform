import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";

export type TenantTransaction = Prisma.TransactionClient;

export interface TenantContext {
  organizationId: string;
  userId?: string;
}

/**
 * Contexto do tenant da requisição corrente. Populado pelo TenantMiddleware do
 * backend a partir do token — NUNCA a partir do body ou de um header controlado
 * pelo cliente.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      "Nenhum tenant no contexto. Rotas de domínio exigem TenantMiddleware.",
    );
  }
  return ctx;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exportada para que a borda HTTP valide o tenant ANTES de chegar ao banco, e
 * devolva 4xx em vez de deixar forTenant() estourar como erro interno.
 */
export function isValidOrganizationId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Executa `fn` dentro de uma transação com o tenant fixado no Postgres.
 *
 * O detalhe que importa está no terceiro argumento de set_config: `true` =
 * *local à transação*. A variável morre no COMMIT/ROLLBACK.
 *
 * Se fosse um `SET` comum, a variável ficaria grudada na CONEXÃO. Com pool, a
 * próxima requisição — de outra empresa — pegaria a mesma conexão e herdaria o
 * organization_id anterior. Esse é o vazamento clássico deste modelo, e é
 * exatamente o que o teste 5 de isolamento cobre.
 *
 * Consequência aceita: toda operação de domínio é uma transação. Para PMEs, o
 * custo é irrelevante perto da garantia.
 */
export async function forTenant<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  // set_config recebe texto; sem esta validação um organization_id vindo de uma
  // origem não confiável entraria como string arbitrária. O cast para uuid no
  // banco barraria, mas falhar aqui dá erro legível em vez de 500 do Postgres.
  if (!UUID_RE.test(organizationId)) {
    throw new Error(`organizationId inválido: ${organizationId}`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, TRUE)`;
    return fn(tx);
  });
}

/**
 * Açúcar sobre forTenant() usando o tenant do AsyncLocalStorage. É o que o código
 * de domínio usa no dia a dia, para que ninguém precise passar organizationId
 * de mão em mão — e, portanto, ninguém possa passar o errado.
 */
export function withTenant<T>(
  prisma: PrismaClient,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return forTenant(prisma, requireTenantContext().organizationId, fn);
}
