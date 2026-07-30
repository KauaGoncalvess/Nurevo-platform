import { Injectable, Logger } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { isValidOrganizationId, tenantStorage } from "@nurevo/database";

/**
 * Populado pelo AuthGuard a partir das claims do token. Ainda não existe — é M1.
 */
interface AuthenticatedRequest extends Request {
  auth?: { organizationId: string; userId: string };
}

const DEV_HEADER = "x-organization-id";

/**
 * Resolve o tenant da requisição e o coloca no AsyncLocalStorage, de onde
 * withTenant() o lê. Nenhum código de domínio recebe organizationId por
 * parâmetro — logo, nenhum código de domínio pode receber o errado.
 *
 * REGRA (doc 01, item 6): o tenant vem SEMPRE do token, nunca do body ou de um
 * header. Um header controlado pelo cliente é troca de tenant à vontade.
 *
 * O fallback por header existe só para o M0, enquanto o Auth não está pronto, e
 * é bloqueado em produção pelo assertDevFallbackDisabled() abaixo — que roda no
 * boot, não na requisição, para o processo morrer antes de aceitar tráfego.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  use(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const fromToken = req.auth?.organizationId;
    const fromHeader = devFallbackEnabled()
      ? (req.header(DEV_HEADER) ?? undefined)
      : undefined;

    const organizationId = fromToken ?? fromHeader;

    // Um id malformado é entrada inválida, não erro interno: segue sem contexto
    // e o TenantGuard devolve 401. Sem esta checagem, o valor só quebraria no
    // cast para uuid dentro do Postgres, virando 500 e ruído de alerta.
    if (!organizationId || !isValidOrganizationId(organizationId)) {
      // Rotas públicas (health, login) precisam funcionar sem tenant. Quem exige
      // tenant é o TenantGuard, e requireTenantContext() é a rede por baixo dele.
      next();
      return;
    }

    if (!fromToken && fromHeader) {
      this.logger.warn(
        `Tenant resolvido pelo header ${DEV_HEADER}. Só desenvolvimento.`,
      );
    }

    tenantStorage.run({ organizationId, userId: req.auth?.userId }, next);
  }
}

function devFallbackEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_TENANT_HEADER === "true"
  );
}

/**
 * Chamado no bootstrap. Falhar no boot é melhor que descobrir em produção que
 * qualquer um podia trocar de empresa mandando um header.
 */
export function assertDevFallbackDisabled(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_TENANT_HEADER === "true"
  ) {
    throw new Error(
      `ALLOW_DEV_TENANT_HEADER=true em produção permitiria trocar de tenant por ` +
        `header. Remova a variável. Ver docs/engineering/01-multi-tenancy.md.`,
    );
  }
}
