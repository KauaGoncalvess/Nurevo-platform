import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate } from "@nestjs/common";
import { getTenantContext } from "@nurevo/database";

/**
 * Barra rota de domínio sem tenant resolvido.
 *
 * Sem isto, a ausência de tenant só estoura lá embaixo, em requireTenantContext(),
 * e vira 500 — um erro de autenticação rotineiro poluindo alerta de erro interno
 * e devolvendo stack trace. A falha correta é 401, explícita e no começo.
 *
 * requireTenantContext() continua sendo a rede de segurança: se alguém esquecer
 * este guard numa rota nova, o pedido falha em vez de listar dados de todos.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(): boolean {
    if (!getTenantContext()) {
      throw new UnauthorizedException("Nenhuma empresa no contexto da requisição.");
    }
    return true;
  }
}
