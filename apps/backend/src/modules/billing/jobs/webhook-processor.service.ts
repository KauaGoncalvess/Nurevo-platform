import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient, createAdminClient } from "@nurevo/database";
import type { NormalizedWebhookEvent } from "../domain/payment-gateway.port";

export interface ProcessResult {
  status: "processed" | "duplicate" | "ignored";
}

/**
 * Processa webhook de gateway. Vive em `jobs/` porque é aqui — e em
 * `modules/admin` — que o lint permite o client BYPASSRLS (doc 01 e 02).
 *
 * O motivo é concreto e não uma conveniência: o evento chega do Asaas
 * identificando uma ASSINATURA do gateway, não uma empresa. Descobrir o tenant
 * exige consultar `subscriptions` cruzando os tenants — que é exatamente a
 * operação administrativa legítima que o client existe para atender.
 *
 * Depois de descobrir o tenant, tudo poderia voltar a passar pelo client normal;
 * mantemos o admin no bloco todo porque a transação precisa ser uma só.
 */
@Injectable()
export class WebhookProcessorService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookProcessorService.name);
  private client: PrismaClient | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  /**
   * Idempotente por construção.
   *
   * O unique `(provider, event_id)` é a garantia real, não um `if` antes do
   * insert: dois reenvios simultâneos passariam os dois por qualquer checagem
   * prévia. Aqui o segundo colide no banco e vira `duplicate`.
   *
   * Isso importa em dinheiro: sem essa constraint, o reenvio de um
   * `PAYMENT_CONFIRMED` credita o pagamento duas vezes.
   */
  async process(
    provider: string,
    event: NormalizedWebhookEvent,
    rawPayload: unknown,
  ): Promise<ProcessResult> {
    const admin = this.admin();

    try {
      await admin.webhookEvent.create({
        data: {
          provider,
          eventId: event.eventId,
          type: event.type,
          payloadJson: rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        this.logger.log(`Evento ${provider}/${event.eventId} já recebido.`);
        return { status: "duplicate" };
      }
      throw error;
    }

    const handled = await this.apply(admin, provider, event);

    await admin.webhookEvent.update({
      where: { provider_eventId: { provider, eventId: event.eventId } },
      data: { processedAt: new Date() },
    });

    return { status: handled ? "processed" : "ignored" };
  }

  private async apply(
    admin: PrismaClient,
    provider: string,
    event: NormalizedWebhookEvent,
  ): Promise<boolean> {
    if (!CONFIRMS_PAYMENT.has(event.type)) return false;
    if (!event.gatewaySubscriptionId) return false;

    const subscription = await admin.subscription.findFirst({
      where: { gatewaySubscriptionId: event.gatewaySubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(
        `Assinatura ${event.gatewaySubscriptionId} do ${provider} não encontrada.`,
      );
      return false;
    }

    await admin.$transaction([
      admin.subscription.update({
        where: { id: subscription.id },
        data: { status: "active" },
      }),
      admin.payment.create({
        data: {
          organizationId: subscription.organizationId,
          method: "pix",
          status: "confirmed",
          amount: new Prisma.Decimal(event.amount ?? 0),
          gateway: provider,
          gatewayPaymentId: event.gatewayPaymentId ?? null,
          paidAt: event.paidAt ?? new Date(),
        },
      }),
    ]);

    return true;
  }

  private admin(): PrismaClient {
    this.client ??= createAdminClient();
    return this.client;
  }
}

const CONFIRMS_PAYMENT = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
]);
