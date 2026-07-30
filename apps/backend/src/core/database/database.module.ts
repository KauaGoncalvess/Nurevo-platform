import { Global, Module } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { createAppClient, PrismaClient } from "@nurevo/database";

export const PRISMA = Symbol("PRISMA");

@Injectable()
class PrismaLifecycle implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

/**
 * Provê o client da aplicação (role nurevo_app, sem BYPASSRLS).
 *
 * Global de propósito: um único pool para o processo. O que varia por
 * requisição é o tenant da transação, não a conexão — ver doc 01.
 */
@Global()
@Module({
  providers: [
    { provide: PRISMA, useFactory: () => createAppClient() },
    PrismaLifecycle,
  ],
  exports: [PRISMA],
})
export class DatabaseModule {}
