import { PrismaClient } from "@prisma/client";

/**
 * Client da APLICAÇÃO.
 *
 * Conecta como `nurevo_app` — role sem BYPASSRLS e sem SUPERUSER. É essa escolha
 * de role, e não o código TypeScript, que garante o isolamento entre tenants.
 * Apontar isto para DATABASE_URL (o owner) não quebra nenhum teste de unidade e
 * silenciosamente desliga metade da proteção; por isso a variável é separada e
 * a checagem abaixo é explícita.
 *
 * Toda leitura/escrita de tabela com organization_id deve passar por forTenant().
 */
export function createAppClient(datasourceUrl?: string): PrismaClient {
  const url = datasourceUrl ?? process.env.DATABASE_URL_APP;

  if (!url) {
    throw new Error(
      "DATABASE_URL_APP não definida. A aplicação não deve usar DATABASE_URL " +
        "(role owner) — ver docs/engineering/01-multi-tenancy.md.",
    );
  }

  return new PrismaClient({ datasourceUrl: url });
}

/**
 * Client ADMINISTRATIVO — conecta como `nurevo_admin`, que TEM BYPASSRLS.
 *
 * Enxerga todos os tenants. Existe para os poucos casos legítimos que cruzam
 * fronteira: job de cobrança recorrente, painel interno, relatório de plataforma.
 *
 * O lint (packages/eslint-config/boundaries.js) proíbe importar isto fora de
 * `modules/admin` e `modules/billing/jobs`. Se você precisou dele em um módulo de
 * domínio, o desenho está errado — o dado deveria vir por um serviço público.
 */
export function createAdminClient(datasourceUrl?: string): PrismaClient {
  const url = datasourceUrl ?? process.env.DATABASE_URL_ADMIN;

  if (!url) {
    throw new Error(
      "DATABASE_URL_ADMIN não definida. Este client ignora RLS — ver doc 01.",
    );
  }

  return new PrismaClient({ datasourceUrl: url });
}
