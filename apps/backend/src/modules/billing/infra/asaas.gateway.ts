import { timingSafeEqual } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  CreateSubscriptionInput,
  GatewayCustomer,
  GatewaySubscription,
  NormalizedWebhookEvent,
  PaymentGateway,
} from "../domain/payment-gateway.port";

/**
 * Adapter do Asaas — Pix, boleto e cartão numa integração só (doc 03).
 *
 * NOTA DE HONESTIDADE: as chamadas HTTP abaixo não foram exercitadas contra o
 * Asaas de verdade, porque isso exige credencial de produção ou sandbox. O que
 * ESTÁ testado é `verifyWebhook` e `parseWebhook` — a parte que decide se um
 * pagamento é considerado recebido, e portanto onde um erro custa dinheiro.
 *
 * É por isso que o gateway está atrás de uma interface: esta é a borda fina.
 */
@Injectable()
export class AsaasGateway implements PaymentGateway {
  readonly name = "asaas";

  async createCustomer(input: {
    name: string;
    email: string;
    document?: string;
  }): Promise<GatewayCustomer> {
    const data = await this.post<{ id: string }>("/customers", {
      name: input.name,
      email: input.email,
      cpfCnpj: input.document,
    });

    return { gatewayCustomerId: data.id };
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<GatewaySubscription> {
    const data = await this.post<{ id: string; status: string }>("/subscriptions", {
      customer: input.gatewayCustomerId,
      billingType: "UNDEFINED", // deixa o cliente escolher Pix/boleto/cartão
      value: input.amount,
      cycle: input.interval === "year" ? "YEARLY" : "MONTHLY",
      description: input.description,
      nextDueDate: input.firstDueDate.toISOString().slice(0, 10),
    });

    return { gatewaySubscriptionId: data.id, status: data.status };
  }

  async cancelSubscription(gatewaySubscriptionId: string): Promise<void> {
    await this.request("DELETE", `/subscriptions/${gatewaySubscriptionId}`);
  }

  /**
   * O Asaas autentica o webhook por um token fixo que a gente configura no
   * painel e ele devolve no header a cada chamada.
   *
   * A comparação é em tempo constante: `===` em string vaza, pelo tempo de
   * resposta, quantos caracteres iniciais estão certos — o que permite
   * descobrir o token byte a byte.
   */
  verifyWebhook(headers: Record<string, string | undefined>): boolean {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN;
    if (!expected) return false;

    const received = headers["asaas-access-token"];
    if (!received) return false;

    const a = Buffer.from(received);
    const b = Buffer.from(expected);

    // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes é seguro,
    // porque o comprimento do token não é o segredo.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): NormalizedWebhookEvent | null {
    if (typeof payload !== "object" || payload === null) return null;

    const body = payload as {
      id?: string;
      event?: string;
      payment?: {
        id?: string;
        subscription?: string;
        value?: number;
        paymentDate?: string;
      };
    };

    if (!body.id || !body.event) return null;

    return {
      eventId: body.id,
      type: body.event,
      gatewaySubscriptionId: body.payment?.subscription,
      gatewayPaymentId: body.payment?.id,
      amount: body.payment?.value,
      paidAt: body.payment?.paymentDate
        ? new Date(body.payment.paymentDate)
        : undefined,
    };
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const apiKey = process.env.ASAAS_API_KEY;
    const baseUrl = process.env.ASAAS_BASE_URL ?? "https://api.asaas.com/v3";

    if (!apiKey) {
      throw new ServiceUnavailableException("Asaas não está configurado.");
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        access_token: apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Asaas respondeu ${response.status} em ${method} ${path}.`,
      );
    }

    return (await response.json()) as T;
  }
}
