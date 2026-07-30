import { Injectable } from "@nestjs/common";
import type { PermissionResolver } from "../../../core/rbac/permission-resolver.port";
import { MembershipsService } from "../application/memberships.service";

const TTL_MS = 30_000;

interface CacheEntry {
  permissions: ReadonlySet<string>;
  expiresAt: number;
}

/**
 * Implementação de PERMISSION_RESOLVER (core/rbac).
 *
 * É aqui que a inversão de dependência da decisão 1 se fecha: `core` declarou a
 * interface, `modules/organizations` a satisfaz. A seta continua modules → core.
 *
 * Cache curto porque isto roda em TODA requisição com @RequiresPermission, e são
 * três joins. 30 segundos é o atraso máximo entre remover alguém de um cargo e o
 * acesso parar — e `invalidate()` derruba na hora nos caminhos que a aplicação
 * conhece. Colocar permissões no token, em vez disso, faria esse atraso ser o
 * tempo de vida do token e sem nenhuma forma de invalidar.
 *
 * Cache em memória: com mais de uma instância, invalidate() só afeta a instância
 * que atendeu a alteração; as outras esperam o TTL. Aceitável em 30s e em
 * instância única (V1, Coolify). Escalando horizontalmente, isto vira Redis.
 */
@Injectable()
export class MembershipPermissionResolver implements PermissionResolver {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly memberships: MembershipsService) {}

  async resolve(
    userId: string,
    organizationId: string,
  ): Promise<ReadonlySet<string>> {
    const key = `${userId}:${organizationId}`;
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const permissions = await this.memberships.resolvePermissions(
      userId,
      organizationId,
    );

    this.cache.set(key, { permissions, expiresAt: Date.now() + TTL_MS });
    return permissions;
  }

  invalidate(userId: string, organizationId: string): void {
    this.cache.delete(`${userId}:${organizationId}`);
  }
}
