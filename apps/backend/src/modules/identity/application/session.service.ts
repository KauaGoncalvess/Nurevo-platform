import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrismaClient } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import { TokenService, hashToken } from "../../../core/auth/token.service";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionSummary {
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
  ) {}

  async startSession(
    userId: string,
    meta: SessionMeta = {},
    organizationId?: string,
  ): Promise<SessionTokens> {
    const issued = this.tokens.issueRefreshToken();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: issued.tokenHash,
        familyId: issued.familyId,
        expiresAt: issued.expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    return {
      accessToken: this.tokens.signAccessToken({
        sub: userId,
        org: organizationId,
      }),
      refreshToken: issued.token,
    };
  }

  /**
   * Rotação com DETECÇÃO DE REUSO.
   *
   * Todo refresh emitido herda o `family_id` do anterior, formando a linhagem de
   * uma sessão. Cada uso rotaciona: o token apresentado é revogado e um novo é
   * emitido na mesma família.
   *
   * O caso que importa é o token JÁ REVOGADO ser apresentado de novo. Em uso
   * normal isso não acontece — o cliente descarta o antigo assim que recebe o
   * novo. Quando acontece, significa que alguém copiou o token: ou o legítimo
   * está reusando o que o ladrão já rotacionou, ou o contrário. Não dá para
   * saber qual dos dois é qual, e por isso a resposta certa é derrubar a família
   * inteira e obrigar os dois a fazer login.
   *
   * Sem essa detecção, um refresh token roubado vale para sempre, silenciosamente.
   */
  async refresh(rawToken: string, meta: SessionMeta = {}): Promise<SessionTokens> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing) {
      throw new UnauthorizedException("Sessão inválida.");
    }

    if (existing.revokedAt) {
      this.logger.warn(
        `Reuso de refresh token detectado. Família ${existing.familyId} revogada.`,
      );
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException("Sessão inválida.");
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException("Sessão expirada.");
    }

    const issued = this.tokens.issueRefreshToken(existing.familyId);

    // Revoga condicionando a ainda estar viva: dois refresh simultâneos com o
    // mesmo token só podem resultar em UMA rotação. O perdedor da corrida cai no
    // caminho de reuso acima na tentativa seguinte, que é o comportamento certo.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
      throw new UnauthorizedException("Sessão inválida.");
    }

    await this.prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: issued.tokenHash,
        familyId: issued.familyId,
        expiresAt: issued.expiresAt,
        ip: meta.ip ?? existing.ip,
        userAgent: meta.userAgent ?? existing.userAgent,
      },
    });

    return {
      accessToken: this.tokens.signAccessToken({ sub: existing.userId }),
      refreshToken: issued.token,
    };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Session Manager do doc 03: uma linha por família viva, não por token. */
  async listSessions(
    userId: string,
    currentRawToken?: string,
  ): Promise<SessionSummary[]> {
    const alive = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    const currentHash = currentRawToken ? hashToken(currentRawToken) : null;

    return alive.map((t) => ({
      familyId: t.familyId,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      ip: t.ip,
      userAgent: t.userAgent,
      current: currentHash !== null && t.tokenHash === currentHash,
    }));
  }

  /**
   * Revogar sessão alheia seria sequestro de sessão às avessas, então a família
   * precisa pertencer a quem pediu.
   */
  async revokeSession(userId: string, familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
