import { AsyncLocalStorage } from "node:async_hooks";
import { UnauthorizedException } from "@nestjs/common";

/**
 * Quem é o usuário desta requisição.
 *
 * Separado do TenantContext (packages/database) de propósito: existe um estado
 * legítimo em que há usuário mas ainda NÃO há empresa — entre o cadastro e o
 * onboarding. Forçar os dois no mesmo objeto obrigaria organizationId a ser
 * opcional lá, e daí a checagem de tenancy viraria opcional junto.
 */
export interface AuthContext {
  userId: string;
  organizationId?: string;
}

export const authStorage = new AsyncLocalStorage<AuthContext>();

export function getAuthContext(): AuthContext | undefined {
  return authStorage.getStore();
}

export function requireAuthContext(): AuthContext {
  const ctx = authStorage.getStore();
  if (!ctx) {
    throw new UnauthorizedException("Autenticação obrigatória.");
  }
  return ctx;
}
