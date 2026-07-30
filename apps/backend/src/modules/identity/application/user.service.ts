import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  emailVerified: boolean;
}

/**
 * Contrato PÚBLICO de leitura de usuário — é o que outros módulos consomem
 * quando precisam do nome de quem fez algo.
 *
 * A alternativa seria cada módulo dar um JOIN em `users`, o que a regra 2 do
 * doc 02 proíbe: é justamente esse join que impediria extrair identity depois.
 */
@Injectable()
export class UserService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async profile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Usuário não encontrado.");

    return toProfile(user);
  }

  /** Resolve vários de uma vez — evita N+1 em listagens (membros, auditoria). */
  async profilesByIds(userIds: string[]): Promise<Map<string, UserProfile>> {
    if (userIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
    });

    return new Map(users.map((u) => [u.id, toProfile(u)]));
  }

  async findIdByEmail(email: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });

    return user?.id ?? null;
  }
}

function toProfile(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  emailVerifiedAt: Date | null;
}): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
