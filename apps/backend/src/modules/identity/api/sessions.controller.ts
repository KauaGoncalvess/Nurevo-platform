import { Controller, Delete, Get, HttpCode, Param } from "@nestjs/common";
import { CurrentUser } from "../../../core/auth/auth.decorators";
import { SessionService } from "../application/session.service";
import type { SessionSummary } from "../application/session.service";

/**
 * Session Manager do doc 03: ver de onde a conta está logada e derrubar o que
 * não reconhecer. Não exige permissão de RBAC — são as sessões do próprio
 * usuário, não um recurso da empresa.
 */
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  list(@CurrentUser() userId: string): Promise<SessionSummary[]> {
    return this.sessions.listSessions(userId);
  }

  @Delete(":familyId")
  @HttpCode(204)
  async revoke(
    @CurrentUser() userId: string,
    @Param("familyId") familyId: string,
  ): Promise<void> {
    // O userId vem do token, não da rota: só dá para derrubar sessão própria.
    await this.sessions.revokeSession(userId, familyId);
  }

  @Delete()
  @HttpCode(204)
  async revokeAll(@CurrentUser() userId: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }
}
