export interface GatewayCustomer {
  gatewayCustomerId: string;
}

export interface GatewaySubscription {
  gatewaySubscriptionId: string;
  status: string;
}

export interface CreateSubscriptionInput {
  gatewayCustomerId: string;
  amount: number;
  interval: "month" | "year";
  description: string;
  /** Primeira cobrança só ao fim do trial. */
  firstDueDate: Date;
}

export interface NormalizedWebhookEvent {
  /** Idempotência: unique (provider, eventId) no banco. */
  eventId: string;
  type: string;
  gatewaySubscriptionId?: string;
  gatewayPaymentId?: string;
  amount?: number;
  paidAt?: Date;
}

/**
 * Interface de gateway em `domain/` — sem Prisma, sem Nest, sem HTTP.
 *
 * O V1 tem um único gateway (Asaas: Pix, boleto e cartão numa integração só).
 * A interface existe mesmo assim porque Stripe entra no primeiro cliente fora do
 * Brasil, e o custo de tê-la agora é uma pasta a mais; o de não tê-la é
 * reescrever regra de negócio quando isso acontecer.
 */
export interface PaymentGateway {
  readonly name: string;

  createCustomer(input: {
    name: string;
    email: string;
    document?: string;
  }): Promise<GatewayCustomer>;

  createSubscription(input: CreateSubscriptionInput): Promise<GatewaySubscription>;

  cancelSubscription(gatewaySubscriptionId: string): Promise<void>;

  /**
   * Confere se o webhook veio mesmo do gateway. Sem isso, qualquer um que
   * descubra a URL marca faturas como pagas.
   */
  verifyWebhook(headers: Record<string, string | undefined>): boolean;

  parseWebhook(payload: unknown): NormalizedWebhookEvent | null;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
