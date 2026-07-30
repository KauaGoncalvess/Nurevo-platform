import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getAuthContext } from "./auth-context";
import { IS_PUBLIC } from "./auth.decorators";

/**
 * Guard global. Exige usuário autenticado, salvo em rotas marcadas com @Public().
 *
 * Não decodifica nada: o TenantMiddleware já verificou o token e populou o
 * contexto. Aqui só se afirma a presença — a verificação precisa acontecer no
 * middleware porque, no Nest, middleware roda ANTES de guard, e é o middleware
 * que precisa do organization_id para abrir a transação com o tenant certo.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    if (!getAuthContext()) {
      throw new UnauthorizedException("Autenticação obrigatória.");
    }

    return true;
  }
}
