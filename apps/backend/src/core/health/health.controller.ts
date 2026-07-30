import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaClient } from "@nurevo/database";
import { PRISMA } from "../database/database.module";
import { Public } from "../auth/auth.decorators";

@Controller("health")
@Public()
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async check(): Promise<{ status: string; database: string }> {
    // Rota pública: não abre transação de tenant nem toca tabela com RLS.
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok" };
  }
}
