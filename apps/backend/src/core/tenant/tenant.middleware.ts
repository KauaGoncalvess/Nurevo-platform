import { Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { isValidOrganizationId, tenantStorage } from "@nurevo/database";
import { authStorage } from "../auth/auth-context";
import { TokenService } from "../auth/token.service";

/**
 * Resolve QUEM é o usuário e QUAL empresa está ativa, a partir do access token,
 * e coloca ambos em AsyncLocalStorage.
 *
 * Por que a verificação do token acontece aqui, e não num guard: no Nest a ordem
 * é middleware → guard → controller. O tenant precisa estar resolvido antes de
 * qualquer coisa abrir transação, então esperar o guard chegaria tarde demais.
 * O AuthGuard, depois, apenas afirma a presença do que foi resolvido aqui.
 *
 * REGRA (doc 01, item 6): o organization_id vem SEMPRE do token. Nunca do body,
 * nunca de header. Até o M0 existia um fallback por header enquanto o Auth não
 * estava pronto; ele foi removido junto com a chegada deste código, que era
 * exatamente a condição combinada para removê-lo.
 *
 * Token ausente ou inválido não é erro aqui — rotas públicas (login, cadastro,
 * health) precisam funcionar. Quem exige contexto é o guard.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const claims = this.extractClaims(req);

    if (!claims) {
      next();
      return;
    }

    const organizationId =
      claims.org && isValidOrganizationId(claims.org) ? claims.org : undefined;

    authStorage.run({ userId: claims.sub, organizationId }, () => {
      if (!organizationId) {
        // Autenticado, mas ainda sem empresa: estado normal entre o cadastro e o
        // onboarding. Rotas de domínio caem no TenantGuard.
        next();
        return;
      }

      tenantStorage.run({ organizationId, userId: claims.sub }, next);
    });
  }

  private extractClaims(req: Request) {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) return null;

    const claims = this.tokens.tryVerifyAccessToken(header.slice(7));
    return claims && isValidOrganizationId(claims.sub) ? claims : null;
  }
}
