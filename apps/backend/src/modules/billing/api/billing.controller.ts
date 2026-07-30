import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { requireTenantContext } from "@nurevo/database";
import { Public } from "../../../core/auth/auth.decorators";
import { ZodPipe } from "../../../core/http/zod-validation.pipe";
import { RequiresPermission } from "../../../core/rbac/rbac.decorators";
import { SubscriptionsService } from "../application/subscriptions.service";
import type { PlanView, SubscriptionView } from "../application/subscriptions.service";
import { EntitlementsService } from "../application/entitlements.service";
import { CachedEntitlementResolver } from "../infra/entitlement.resolver";

const planSchema = z.object({ planKey: z.string().min(1).max(40) });
const cancelSchema = z.object({ immediately: z.boolean().optional() });

@Controller("billing")
export class BillingController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly entitlements: EntitlementsService,
    private readonly resolver: CachedEntitlementResolver,
  ) {}

  /** Tabela de preços é pública: precisa aparecer na landing, antes do cadastro. */
  @Public()
  @Get("plans")
  listPlans(): Promise<PlanView[]> {
    return this.subscriptions.listPlans();
  }

  @Get("subscription")
  @RequiresPermission("billing:read")
  current(): Promise<SubscriptionView | null> {
    const { organizationId } = requireTenantContext();
    return this.subscriptions.current(organizationId);
  }

  @Post("subscribe")
  @HttpCode(201)
  @RequiresPermission("billing:write")
  async subscribe(
    @Body(new ZodPipe(planSchema)) body: { planKey: string },
  ): Promise<SubscriptionView> {
    const { organizationId } = requireTenantContext();
    const subscription = await this.subscriptions.startTrial(
      organizationId,
      body.planKey,
    );

    this.resolver.invalidate(organizationId);
    return subscription;
  }

  @Post("change-plan")
  @HttpCode(200)
  @RequiresPermission("billing:write")
  async changePlan(
    @Body(new ZodPipe(planSchema)) body: { planKey: string },
  ): Promise<SubscriptionView> {
    const { organizationId } = requireTenantContext();
    const subscription = await this.subscriptions.changePlan(
      organizationId,
      body.planKey,
    );

    // Sem isto, o cliente que acabou de fazer upgrade continuaria esbarrando no
    // limite antigo por até 5 minutos.
    this.resolver.invalidate(organizationId);
    return subscription;
  }

  @Post("cancel")
  @HttpCode(204)
  @RequiresPermission("billing:write")
  async cancel(
    @Body(new ZodPipe(cancelSchema)) body: { immediately?: boolean },
  ): Promise<void> {
    const { organizationId } = requireTenantContext();
    await this.subscriptions.cancel(organizationId, body.immediately ?? false);
    this.resolver.invalidate(organizationId);
  }

  @Get("usage")
  @RequiresPermission("billing:read")
  async usage(): Promise<{ featureKey: string; used: number; limit: number | null }[]> {
    const { organizationId } = requireTenantContext();

    const keys = ["appointments.max_per_month", "files.storage_gb"];
    const rows = await Promise.all(
      keys.map(async (featureKey) => {
        const counter = await this.entitlements.currentUsage(
          organizationId,
          featureKey,
        );
        return {
          featureKey,
          used: counter?.used ?? 0,
          limit: counter?.limitSnapshot ?? null,
        };
      }),
    );

    return rows;
  }
}
