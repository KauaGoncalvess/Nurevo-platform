import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient, forTenant } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import type {
  ConsumeResult,
  EntitlementValue,
} from "../../../core/entitlements/entitlement-resolver.port";

@Injectable()
export class EntitlementsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Recalcula `organization_entitlements` a partir do plano.
   *
   * Chamada na assinatura e em toda troca de plano. Overrides comerciais
   * (`source = 'override'`) NÃO são tocados: é justamente para eles que a
   * materialização existe. Se a resposta viesse do plano na hora, uma cortesia
   * dada a um cliente viraria `if` espalhado pelo código.
   */
  async materializeFromPlan(
    organizationId: string,
    planId: string,
  ): Promise<void> {
    const planFeatures = await this.prisma.planFeature.findMany({
      where: { planId },
      include: { feature: true },
    });

    await forTenant(this.prisma, organizationId, async (tx) => {
      await tx.organizationEntitlement.deleteMany({
        where: { organizationId, source: "plan" },
      });

      if (planFeatures.length === 0) return;

      await tx.organizationEntitlement.createMany({
        data: planFeatures.map((pf) => ({
          organizationId,
          featureKey: pf.feature.key,
          value: pf.value as object,
          source: "plan" as const,
        })),
      });
    });
  }

  /**
   * Precedência: override > addon > plan.
   *
   * Um override é a decisão comercial mais recente e específica; ele tem que
   * ganhar do plano, senão dar cortesia exigiria mudar o plano do cliente.
   */
  async getFeature(
    organizationId: string,
    featureKey: string,
  ): Promise<EntitlementValue | null> {
    const rows = await forTenant(this.prisma, organizationId, (tx) =>
      tx.organizationEntitlement.findMany({
        where: {
          featureKey,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    );

    if (rows.length === 0) return null;

    const byPrecedence = ["override", "addon", "plan"];
    rows.sort(
      (a, b) => byPrecedence.indexOf(a.source) - byPrecedence.indexOf(b.source),
    );

    return rows[0]!.value as EntitlementValue;
  }

  async hasModule(organizationId: string, moduleKey: string): Promise<boolean> {
    const subscription = await forTenant(this.prisma, organizationId, (tx) =>
      tx.subscription.findFirst({
        where: { status: { in: ["trialing", "active", "past_due"] } },
      }),
    );

    if (!subscription) return false;

    const included = await this.prisma.planModule.findFirst({
      where: { planId: subscription.planId, module: { key: moduleKey } },
    });

    return included !== null;
  }

  /**
   * Incremento atômico do contador de uso.
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... WHERE` resolve num único comando o que
   * "ler, somar, comparar, gravar" não resolve: duas requisições simultâneas no
   * limite 500 com 499 usados passariam as duas na checagem em memória e
   * gravariam 501. Aqui a segunda não encontra linha para atualizar e o
   * RETURNING volta vazio.
   *
   * Feature ausente ou booleana `true` = sem limite; nesse caso o consumo é
   * apenas registrado, para a empresa ver o próprio uso.
   */
  async consume(
    organizationId: string,
    featureKey: string,
    amount: number,
  ): Promise<ConsumeResult> {
    const entitlement = await this.getFeature(organizationId, featureKey);

    const limit =
      entitlement && typeof entitlement === "object" && "limit" in entitlement
        ? entitlement.limit
        : null;

    if (entitlement === false) {
      return { allowed: false, used: 0, limit: 0 };
    }

    // Pedido maior que o limite inteiro: barra antes de tocar no banco, senão o
    // caminho de INSERT (sem conflito) não teria WHERE para reprovar.
    if (limit !== null && amount > limit) {
      return { allowed: false, used: 0, limit };
    }

    const period = currentPeriod();

    return forTenant(this.prisma, organizationId, async (tx) => {
      const rows = await tx.$queryRaw<{ used: number }[]>`
        INSERT INTO usage_counters
          (id, organization_id, feature_key, period, used, limit_snapshot, created_at, updated_at)
        VALUES
          (uuid_generate_v7(), ${organizationId}::uuid, ${featureKey}, ${period},
           ${amount}, ${limit}, now(), now())
        ON CONFLICT (organization_id, feature_key, period) DO UPDATE
          SET used = usage_counters.used + ${amount},
              limit_snapshot = ${limit},
              updated_at = now()
          WHERE ${limit}::int IS NULL
             OR usage_counters.used + ${amount} <= ${limit}::int
        RETURNING used
      `;

      const row = rows[0];
      if (!row) {
        const current = await tx.usageCounter.findFirst({
          where: { featureKey, period },
        });
        return { allowed: false, used: current?.used ?? 0, limit };
      }

      return { allowed: true, used: row.used, limit };
    });
  }

  async currentUsage(organizationId: string, featureKey: string) {
    return forTenant(this.prisma, organizationId, (tx) =>
      tx.usageCounter.findFirst({ where: { featureKey, period: currentPeriod() } }),
    );
  }
}

/** Competência mensal em UTC — `2026-07`. */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
