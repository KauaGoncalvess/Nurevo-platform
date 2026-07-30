import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { requireAuthContext } from "../auth/auth-context";
import { PERMISSION_RESOLVER } from "./permission-resolver.port";
import type { PermissionResolver } from "./permission-resolver.port";
import { REQUIRED_PERMISSIONS } from "./rbac.decorators";

/**
 * Guard global de RBAC. Rota sem @RequiresPermission passa direto — a decisão de
 * exigir permissão é do controller, porque muitas rotas autenticadas
 * legitimamente não exigem nenhuma (ver o próprio perfil, listar minhas empresas).
 *
 * RLS e RBAC respondem perguntas diferentes e nenhum substitui o outro: o banco
 * diz "esse dado é da empresa X"; isto aqui diz "você pode fazer isso dentro da
 * empresa X" (doc 01, seção "O que RLS não resolve").
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_RESOLVER)
    private readonly resolver: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const { userId, organizationId } = requireAuthContext();

    // Exigir permissão sem empresa ativa é sempre negação: permissão só existe
    // dentro de um tenant.
    if (!organizationId) {
      throw new ForbiddenException("Nenhuma empresa ativa na sessão.");
    }

    const granted = await this.resolver.resolve(userId, organizationId);
    const missing = required.filter((p) => !granted.has(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Permissão insuficiente: ${missing.join(", ")}.`,
      );
    }

    return true;
  }
}
