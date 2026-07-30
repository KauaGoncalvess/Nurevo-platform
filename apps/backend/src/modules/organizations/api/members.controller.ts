import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../../core/auth/auth.decorators";
import { RequiresPermission } from "../../../core/rbac/rbac.decorators";
import { requireTenantContext } from "@nurevo/database";
import { ZodPipe } from "../../../core/http/zod-validation.pipe";
import { InvitationsService } from "../application/invitations.service";
import type { PendingInvitation } from "../application/invitations.service";
import { MembershipsService } from "../application/memberships.service";
import { UserService } from "../../identity";

interface MemberView {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  roleKey: string;
  status: string;
  joinedAt: Date | null;
}
import { acceptInviteSchema, inviteSchema } from "./organizations.dto";
import type { AcceptInviteInput, InviteInput } from "./organizations.dto";

/**
 * Consumo de outro módulo pelo contrato público (`../../identity`), não pelo
 * interno — regra 1 do doc 02. O nome de quem convidou vem do UserService, e não
 * de um JOIN em `users`, que a regra 2 proíbe.
 */
@Controller("members")
export class MembersController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly invitations: InvitationsService,
    private readonly users: UserService,
  ) {}

  @Get()
  @RequiresPermission("members:read")
  async list(@CurrentUser() userId: string): Promise<MemberView[]> {
    const { organizationId } = requireTenantContext();
    const rows = await this.memberships.listMembers(organizationId, userId);
    const profiles = await this.users.profilesByIds(rows.map((r) => r.userId));

    return rows.map((r) => ({
      ...r,
      name: profiles.get(r.userId)?.name ?? null,
      email: profiles.get(r.userId)?.email ?? null,
    }));
  }

  @Get("invitations")
  @RequiresPermission("members:read")
  listInvitations(@CurrentUser() userId: string): Promise<PendingInvitation[]> {
    const { organizationId } = requireTenantContext();
    return this.invitations.listPending(organizationId, userId);
  }

  @Post("invitations")
  @HttpCode(201)
  @RequiresPermission("members:write")
  async invite(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(inviteSchema)) body: InviteInput,
  ) {
    const { organizationId } = requireTenantContext();

    const invitation = await this.invitations.invite({
      organizationId,
      invitedBy: userId,
      email: body.email,
      roleKey: body.roleKey,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      // O token só aparece fora de produção. Em produção ele existe apenas
      // dentro do e-mail — devolvê-lo aqui permitiria a quem convida entrar na
      // conta de quem foi convidado.
      token: process.env.NODE_ENV === "production" ? undefined : invitation.token,
    };
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  @RequiresPermission("members:write")
  async revokeInvitation(
    @CurrentUser() userId: string,
    @Param("id") id: string,
  ): Promise<void> {
    const { organizationId } = requireTenantContext();
    await this.invitations.revoke(organizationId, id, userId);
  }
}

/**
 * Aceitar convite fica fora do controller acima de propósito: quem aceita ainda
 * não é membro, logo não tem tenant nem permissão. Exigir @RequiresPermission
 * aqui tornaria o convite impossível de aceitar.
 */
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("accept")
  @HttpCode(200)
  accept(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(acceptInviteSchema)) body: AcceptInviteInput,
  ): Promise<{ organizationId: string }> {
    return this.invitations.accept(body.token, userId);
  }
}
