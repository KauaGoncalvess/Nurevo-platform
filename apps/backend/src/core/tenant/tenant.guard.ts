import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate } from "@nestjs/common";
import { getTenantContext } from "@nurevo/database";
import { getAuthContext } from "../auth/auth-context";

/**
 * Barra rota de domínio sem empresa ativa na sessão.
 *
 * A distinção entre os dois erros é deliberada:
 *
 *   401 — não há token. O cliente precisa autenticar.
 *   403 — há token válido, mas nenhuma empresa ativa. O cliente precisa
 *         escolher uma empresa (POST /organizations/switch) ou criar a primeira.
 *
 * Responder 401 no segundo caso mandaria o cliente para a tela de login, onde
 * ele já está logado — e o usuário ficaria num laço sem entender o motivo.
 *
 * requireTenantContext() continua sendo a rede por baixo: se alguém esquecer
 * este guard numa rota nova, o pedido falha em vez de listar dados de todos.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(): boolean {
    if (getTenantContext()) return true;

    if (!getAuthContext()) {
      throw new UnauthorizedException("Autenticação obrigatória.");
    }

    throw new ForbiddenException(
      "Nenhuma empresa ativa na sessão. Escolha uma empresa para continuar.",
    );
  }
}
