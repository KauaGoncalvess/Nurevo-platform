/**
 * Porta que resolve o problema criado pela regra 3 do doc 02.
 *
 * `core/` não pode importar de `modules/`. Mas avaliar permissão exige ler
 * memberships → roles → permissions, que vivem em `modules/organizations`.
 *
 * A saída é inversão de dependência: `core/rbac` DEFINE a interface de que
 * precisa; `modules/organizations` a implementa e se registra. A seta continua
 * apontando `modules → core`, e o lint de fronteiras confirma isso a cada CI.
 *
 * O mesmo padrão vale para ENTITLEMENT_RESOLVER, implementado por modules/billing.
 */
export interface PermissionResolver {
  /**
   * Permissões efetivas do usuário na empresa. Conjunto vazio quando não há
   * membership ativa — nunca lança, para que "não é membro" e "não tem a
   * permissão" resultem no mesmo 403 e não vazem a existência da empresa.
   */
  resolve(userId: string, organizationId: string): Promise<ReadonlySet<string>>;

  /** Chamada quando a membership ou o cargo muda, para não servir cache velho. */
  invalidate(userId: string, organizationId: string): void;
}

export const PERMISSION_RESOLVER = Symbol("PERMISSION_RESOLVER");
