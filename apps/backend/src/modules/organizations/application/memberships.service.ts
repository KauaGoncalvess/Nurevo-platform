import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient, forTenant, forUser } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";

export interface MemberRow {
  id: string;
  userId: string;
  roleKey: string;
  status: string;
  joinedAt: Date | null;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  slug: string;
  roleKey: string;
  status: string;
}

@Injectable()
export class MembershipsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * "Minhas empresas" — a consulta que roda logo depois do login, quando ainda
   * não há tenant escolhido.
   *
   * `forUser` seta apenas `app.user_id`, e as políticas own_memberships e
   * member_organizations (migration do M1) fazem o resto. Nenhuma outra tabela
   * fica visível nesse escopo: sem tenant, tudo mais devolve zero linhas.
   */
  async listForUser(userId: string): Promise<MembershipSummary[]> {
    return forUser(this.prisma, userId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { status: "active" },
        include: { role: true, organization: true },
      });

      return memberships
        .filter((m) => m.organization !== null)
        .map((m) => ({
          organizationId: m.organizationId,
          organizationName: m.organization.tradeName ?? m.organization.legalName,
          slug: m.organization.slug,
          roleKey: m.role.key,
          status: m.status,
        }));
    });
  }

  /** Usado na troca de empresa: prova que a pessoa pode assumir aquele tenant. */
  async hasActiveMembership(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const found = await forUser(this.prisma, userId, (tx) =>
      tx.membership.findFirst({
        where: { organizationId, status: "active" },
        select: { id: true },
      }),
    );

    return found !== null;
  }

  /**
   * Devolve tipo próprio, não a entidade Prisma. Além de a regra do doc 02
   * pedir isso, entidade do Prisma gerada sob pnpm não tem tipo nomeável fora do
   * pacote — então vazá-la quebraria a compilação de quem consome.
   */
  async listMembers(
    organizationId: string,
    userId: string,
  ): Promise<MemberRow[]> {
    const rows = await forTenant(
      this.prisma,
      organizationId,
      (tx) =>
        tx.membership.findMany({
          include: { role: true },
          orderBy: { createdAt: "asc" },
        }),
      userId,
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      roleKey: r.role.key,
      status: r.status,
      joinedAt: r.joinedAt,
    }));
  }

  /**
   * Permissões efetivas: membership ativa → role → permissions.
   *
   * RBAC V1 é flat de propósito (doc 03): sem ACL por registro, sem hierarquia
   * de cargos, sem policy dinâmica. Cobre a PME que é o cliente do V1.
   */
  async resolvePermissions(
    userId: string,
    organizationId: string,
  ): Promise<ReadonlySet<string>> {
    const membership = await forTenant(
      this.prisma,
      organizationId,
      (tx) =>
        tx.membership.findFirst({
          where: { userId, status: "active" },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        }),
      userId,
    );

    if (!membership) return new Set();

    return new Set(membership.role.permissions.map((rp) => rp.permission.key));
  }
}
