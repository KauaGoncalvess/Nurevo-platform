/**
 * Contrato PÚBLICO do módulo billing (doc 02).
 *
 * O que outros módulos precisam daqui é "essa empresa pode usar isso?" e
 * "registre esse consumo" — não a assinatura, não a fatura, não o gateway.
 * Por isso o que sai é o serviço de entitlements e o de assinatura, e nada de
 * `infra/` ou `jobs/`.
 *
 * Eventos publicados: nenhum ainda. `subscription.activated` e
 * `subscription.past_due` entram quando notificações existirem (M4).
 */
export { BillingModule } from "./billing.module";
export { EntitlementsService } from "./application/entitlements.service";
export { SubscriptionsService } from "./application/subscriptions.service";
export type {
  PlanView,
  SubscriptionView,
} from "./application/subscriptions.service";
