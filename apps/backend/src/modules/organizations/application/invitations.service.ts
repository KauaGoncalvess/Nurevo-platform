import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaClient, forInvitationToken, forTenant } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import { hashToken } from "../../../core/auth/token.service";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingInvitation {
  id: string;
  email: string;
  roleKey: string;
  expiresAt: Date;
}

export interface CreatedInvitation {
  id: string;
  email: string;
  /** Em claro, só neste retorno — vai para o e-mail e nunca é persistido. */
  token: string;
  expiresAt: Date;
}

@Injectable()
export class InvitationsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async invite(input: {
    organizationId: string;
    invitedBy: string;
    email: string;
    roleKey: string;
  }): Promise<CreatedInvitation> {
    const email = input.email.trim().toLowerCase();
    const token = randomBytes(32).toString("base64url");

    return forTenant(
      this.prisma,
      input.organizationId,
      async (tx) => {
        const role = await tx.role.findFirst({ where: { key: input.roleKey } });
        if (!role) {
          throw new BadRequestException(`Cargo "${input.roleKey}" não existe.`);
        }

        const pending = await tx.invitation.findFirst({
          where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
        });
        if (pending) {
          throw new ConflictException(
            "Já existe um convite pendente para este e-mail.",
          );
        }

        const invitation = await tx.invitation.create({
          data: {
            organizationId: input.organizationId,
            email,
            roleId: role.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            invitedBy: input.invitedBy,
          },
        });

        return {
          id: invitation.id,
          email: invitation.email,
          token,
          expiresAt: invitation.expiresAt,
        };
      },
      input.invitedBy,
    );
  }

  /**
   * Aceitar convite acontece ANTES de a pessoa ser membro — logo, sem tenant.
   *
   * `forInvitationToken` destrava exatamente a linha cujo hash foi apresentado
   * (política invitation_by_token). Só depois de saber a qual empresa o convite
   * pertence é que se abre a transação de tenant para criar a membership.
   *
   * São duas transações, e isso é visível: se a segunda falhar, o convite
   * continua pendente e a pessoa tenta de novo. O inverso — membership criada e
   * convite não consumido — não acontece, porque as duas escritas estão juntas
   * na segunda transação.
   */
  async accept(rawToken: string, userId: string): Promise<{ organizationId: string }> {
    const tokenHash = hashToken(rawToken);

    const invitation = await forInvitationToken(this.prisma, tokenHash, (tx) =>
      tx.invitation.findFirst({ where: { tokenHash } }),
    );

    if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
      throw new NotFoundException("Convite inválido ou expirado.");
    }

    await forTenant(
      this.prisma,
      invitation.organizationId,
      async (tx) => {
        const consumed = await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });

        // Dois cliques no link do e-mail: só o primeiro cria membership.
        if (consumed.count === 0) {
          throw new NotFoundException("Convite inválido ou expirado.");
        }

        await tx.membership.upsert({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId,
            },
          },
          create: {
            organizationId: invitation.organizationId,
            userId,
            roleId: invitation.roleId,
            status: "active",
            invitedBy: invitation.invitedBy,
            joinedAt: new Date(),
          },
          update: {
            roleId: invitation.roleId,
            status: "active",
            joinedAt: new Date(),
          },
        });
      },
      userId,
    );

    return { organizationId: invitation.organizationId };
  }

  async listPending(
    organizationId: string,
    userId: string,
  ): Promise<PendingInvitation[]> {
    const rows = await forTenant(
      this.prisma,
      organizationId,
      (tx) =>
        tx.invitation.findMany({
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          include: { role: true },
          orderBy: { createdAt: "desc" },
        }),
      userId,
    );

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      roleKey: r.role.key,
      expiresAt: r.expiresAt,
    }));
  }

  async revoke(organizationId: string, invitationId: string, userId: string) {
    await forTenant(
      this.prisma,
      organizationId,
      (tx) => tx.invitation.deleteMany({ where: { id: invitationId } }),
      userId,
    );
  }
}
