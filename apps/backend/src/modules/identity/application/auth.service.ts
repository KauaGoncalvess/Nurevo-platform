import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaClient } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import { PasswordService } from "../../../core/auth/password.service";
import { TokenService, hashToken } from "../../../core/auth/token.service";
import { MAILER } from "../domain/mailer.port";
import type { MailerPort } from "../domain/mailer.port";
import { SessionService } from "./session.service";
import type { SessionTokens } from "./session.service";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * As tabelas de identity são GLOBAIS — sem organization_id, sem RLS (doc 01).
 * Por isso este serviço usa o client direto e não withTenant(): identidade
 * pertence à pessoa, não à empresa. Uma pessoa, uma conta, N empresas.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MAILER) private readonly mailer: MailerPort,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Cadastro devolve 409 em e-mail duplicado, enquanto login e reset são
   * deliberadamente genéricos.
   *
   * A assimetria é intencional: no cadastro a pessoa PRECISA saber que já tem
   * conta, senão fica travada sem entender por quê, e esconder isso não protege
   * nada — quem quer enumerar e-mails já descobre pelo próprio fluxo. Nos outros
   * dois não existe esse custo de usabilidade, então lá vale calar.
   */
  async signup(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ userId: string }> {
    const email = normalizeEmail(input.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("Já existe uma conta com este e-mail.");
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash: await this.passwords.hash(input.password),
      },
    });

    await this.sendVerificationEmail(user.id, email);
    return { userId: user.id };
  }

  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const token = await this.issueEmailToken(userId, "verify", VERIFICATION_TTL_MS);

    await this.mailer.send({
      to: email,
      subject: "Confirme seu e-mail — Nurevo",
      body: `${appUrl()}/verificar-email?token=${token}`,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.consumeEmailToken(rawToken, "verify");

    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  /**
   * Mensagem única para "e-mail não existe", "senha errada" e "conta bloqueada".
   * Distinguir esses casos entrega uma lista de e-mails válidos a quem estiver
   * testando credenciais vazadas de outro site.
   *
   * O hash é verificado mesmo quando o usuário não existe: sem isso, a diferença
   * de tempo de resposta responde a mesma pergunta que a mensagem não responde.
   */
  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<SessionTokens> {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    const passwordOk = await this.passwords.verify(
      user?.passwordHash ?? null,
      input.password,
    );

    if (!user || !passwordOk || user.status !== "active") {
      throw new UnauthorizedException("E-mail ou senha inválidos.");
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Confirme seu e-mail antes de entrar. Reenviamos o link se precisar.",
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.sessions.startSession(user.id, {
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  /**
   * Sempre 202, exista a conta ou não. Aqui o silêncio não custa usabilidade:
   * quem tem conta recebe o e-mail, quem não tem não fica sabendo de nada.
   */
  async requestPasswordReset(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) return;

    const token = await this.issueEmailToken(user.id, "reset", RESET_TTL_MS);

    await this.mailer.send({
      to: email,
      subject: "Redefinir sua senha — Nurevo",
      body: `${appUrl()}/redefinir-senha?token=${token}`,
    });
  }

  /**
   * Trocar a senha derruba TODAS as sessões do usuário.
   *
   * Quem redefine senha frequentemente está reagindo a um acesso indevido. Se as
   * sessões antigas sobrevivessem, o invasor continuaria dentro com o refresh
   * token que já tem, e a redefinição seria teatro.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.consumeEmailToken(rawToken, "reset");

    await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        // Quem chegou aqui provou controle sobre a caixa de e-mail.
        emailVerifiedAt: new Date(),
      },
    });

    await this.sessions.revokeAllForUser(record.userId);
  }

  private async issueEmailToken(
    userId: string,
    purpose: "verify" | "reset",
    ttlMs: number,
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");

    // Só um token vivo por finalidade: pedir um novo link invalida o anterior.
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return token;
  }

  private async consumeEmailToken(rawToken: string, purpose: "verify" | "reset") {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (
      !record ||
      record.purpose !== purpose ||
      record.consumedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException("Link inválido ou expirado.");
    }

    // Marca consumido condicionando a ainda estar não-consumido: duas requisições
    // simultâneas com o mesmo link resultam em uma só efetivação.
    const consumed = await this.prisma.emailVerificationToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw new BadRequestException("Link inválido ou expirado.");
    }

    return record;
  }
}

/**
 * A coluna é citext, então o banco já compara sem diferenciar maiúsculas. O trim
 * e o lower aqui evitam gravar variações visuais do mesmo endereço.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}
