import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient, withTenant } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";

export interface BranchSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

@Injectable()
export class BranchesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Sem `where: { organizationId }` em lugar nenhum — e é assim que deve ser.
   * withTenant() abre a transação com o tenant fixado e o Postgres faz o resto.
   * Se o contexto não existir, isto lança em vez de devolver dados de todos.
   */
  async list(): Promise<BranchSummary[]> {
    return withTenant(this.prisma, (tx) =>
      tx.branch.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, isDefault: true },
        orderBy: { name: "asc" },
      }),
    );
  }
}
