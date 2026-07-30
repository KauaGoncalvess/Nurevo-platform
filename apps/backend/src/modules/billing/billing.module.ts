import { Module } from "@nestjs/common";
import { ENTITLEMENT_RESOLVER } from "../../core/entitlements/entitlement-resolver.port";
import { BillingController } from "./api/billing.controller";
import { WebhooksController } from "./api/webhooks.controller";
import { EntitlementsService } from "./application/entitlements.service";
import { SubscriptionsService } from "./application/subscriptions.service";
import { PAYMENT_GATEWAY } from "./domain/payment-gateway.port";
import { AsaasGateway } from "./infra/asaas.gateway";
import { CachedEntitlementResolver } from "./infra/entitlement.resolver";
import { WebhookProcessorService } from "./jobs/webhook-processor.service";

@Module({
  controllers: [BillingController, WebhooksController],
  providers: [
    EntitlementsService,
    SubscriptionsService,
    WebhookProcessorService,
    CachedEntitlementResolver,
    AsaasGateway,
    // Gateway atrás do token: Stripe entra trocando esta linha, sem tocar em
    // regra de negócio (doc 03).
    { provide: PAYMENT_GATEWAY, useExisting: AsaasGateway },
    // Fecha a inversão de dependência com core/entitlements.
    { provide: ENTITLEMENT_RESOLVER, useExisting: CachedEntitlementResolver },
  ],
  exports: [ENTITLEMENT_RESOLVER, EntitlementsService, SubscriptionsService],
})
export class BillingModule {}
