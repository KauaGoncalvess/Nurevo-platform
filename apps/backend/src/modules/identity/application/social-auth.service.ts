import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaClient } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import { SOCIAL_PROVIDERS } from "../domain/social-provider.port";
import type {
  SocialProfile,
  SocialProviderKey,
  SocialProviderPort,
} from "../domain/social-provider.port";
import { SessionService } from "./session.service";
import type { SessionTokens } from "./session.service";

@Injectable()
export class SocialAuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SOCIAL_PROVIDERS)
    private readonly providers: SocialProviderPort[],
    private readonly sessions: SessionService,
  ) {}

  async authenticate(
    providerKey: SocialProviderKey,
    credential: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<SessionTokens> {
    const provider = this.providers.find((p) => p.key === providerKey);
    if (!provider) {
      throw new UnauthorizedException(`Provedor ${providerKey} não habilitado.`);
    }

    const profile = await provider.verify(credential);
    const userId = await this.resolveUser(profile);

    return this.sessions.startSession(userId, meta);
  }

  /**
   * Vinculação de conta — a parte perigosa do login social.
   *
   * O ataque: alguém cria conta no provedor X usando o e-mail da vítima, sem
   * nunca provar que controla a caixa. Se a gente vinculasse pelo e-mail, essa
   * pessoa entraria na conta existente da vítima. É tomada de conta completa,
   * e é um bug clássico o suficiente para ter nome.
   *
   * Por isso vincular exige as DUAS pontas verificadas: o provedor precisa
   * afirmar `email_verified`, e a conta local precisa ter e-mail confirmado.
   * Faltando qualquer uma, o caminho é entrar por senha e vincular já autenticado.
   */
  private async resolveUser(profile: SocialProfile): Promise<string> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
        },
      },
    });

    // Caminho quente: identidade já vinculada.
    if (identity) return identity.userId;

    const email = profile.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (!existing) {
      const created = await this.prisma.user.create({
        data: {
          email,
          name: profile.name,
          avatarUrl: profile.avatarUrl ?? null,
          // Conta nascida de login social não tem senha. É por isso que
          // password_hash é nullable (doc 03, tabela 1).
          passwordHash: null,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
          identities: {
            create: {
              provider: profile.provider,
              providerUserId: profile.providerUserId,
              email,
            },
          },
        },
      });

      return created.id;
    }

    if (!profile.emailVerified || !existing.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Já existe uma conta com este e-mail. Entre com sua senha e vincule " +
          "o login social pelas configurações da conta.",
      );
    }

    await this.prisma.userIdentity.create({
      data: {
        userId: existing.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email,
      },
    });

    return existing.id;
  }
}
