import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Prisma, PrismaClient, forTenant } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";
import { EntitlementsService } from "./entitlements.service";

export interface SubscriptionView {
  id: string;
  planKey: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface PlanView {
  key: string;
  name: string;
  description: string | null;
  trialDays: number;
  prices: { interval: string; amount: string; currency: string }[];
  modules: string[];
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Catálogo é global: sem RLS, mesma resposta para todo mundo. */
  async listPlans(): Promise<PlanView[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { sortOrder: "asc" },
      include: {
        prices: { where: { active: true } },
        planModules: { include: { module: true } },
      },
    });

    return plans.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      trialDays: p.trialDays,
      prices: p.prices.map((pr) => ({
        interval: pr.interval,
        amount: pr.amount.toString(),
        currency: pr.currency,
      })),
      modules: p.planModules.map((pm) => pm.module.key),
    }));
  }

  /**
   * Inicia o trial. Nenhum dado de pagamento é pedido aqui — cartão só entra na
   * conversão, e é isso que faz o trial ser de 14 dias sem atrito (doc 04).
   *
   * O índice parcial `subscriptions_one_live_per_org` é quem garante uma
   * assinatura viva por empresa; o erro de unicidade abaixo é a tradução dele.
   */
  async startTrial(
    organizationId: string,
    planKey: string,
  ): Promise<SubscriptionView> {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) throw new BadRequestException(`Plano "${planKey}" não existe.`);

    const trialEndsAt = new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000);

    let created;
    try {
      created = await forTenant(this.prisma, organizationId, (tx) =>
        tx.subscription.create({
          data: {
            organizationId,
            planId: plan.id,
            status: "trialing",
            trialEndsAt,
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEndsAt,
          },
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Esta empresa já tem uma assinatura ativa.");
      }
      throw error;
    }

    // Só depois de existir assinatura é que o tenant ganha os entitlements.
    await this.entitlements.materializeFromPlan(organizationId, plan.id);

    return toView(created, plan.key);
  }

  async current(organizationId: string): Promise<SubscriptionView | null> {
    const subscription = await forTenant(this.prisma, organizationId, (tx) =>
      tx.subscription.findFirst({
        where: { status: { in: ["trialing", "active", "past_due"] } },
        include: { plan: true },
      }),
    );

    return subscription ? toView(subscription, subscription.plan.key) : null;
  }

  async changePlan(
    organizationId: string,
    planKey: string,
  ): Promise<SubscriptionView> {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) throw new BadRequestException(`Plano "${planKey}" não existe.`);

    const updated = await forTenant(this.prisma, organizationId, async (tx) => {
      const current = await tx.subscription.findFirst({
        where: { status: { in: ["trialing", "active", "past_due"] } },
      });

      if (!current) {
        throw new BadRequestException("Nenhuma assinatura ativa para alterar.");
      }

      return tx.subscription.update({
        where: { id: current.id },
        data: { planId: plan.id },
      });
    });

    // Recalcular aqui é obrigatório: sem isso o cliente pagaria o plano novo
    // continuando com os limites do antigo.
    await this.entitlements.materializeFromPlan(organizationId, plan.id);

    return toView(updated, plan.key);
  }

  async cancel(organizationId: string, immediately = false): Promise<void> {
    await forTenant(this.prisma, organizationId, async (tx) => {
      const current = await tx.subscription.findFirst({
        where: { status: { in: ["trialing", "active", "past_due"] } },
      });
      if (!current) return;

      await tx.subscription.update({
        where: { id: current.id },
        data: immediately
          ? { status: "canceled", cancelAtPeriodEnd: false }
          : { cancelAtPeriodEnd: true },
      });
    });
  }
}

function toView(
  s: {
    id: string;
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  },
  planKey: string,
): SubscriptionView {
  return {
    id: s.id,
    planKey,
    status: s.status,
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  };
}
