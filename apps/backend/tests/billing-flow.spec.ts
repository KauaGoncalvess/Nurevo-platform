import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { forTenant } from "@nurevo/database";
import { createTestApp, uniqueEmail } from "./helpers/app";
import type { CapturingMailer, TestApp } from "./helpers/app";
import { PRISMA } from "../src/core/database/database.module";
import { EntitlementsService } from "../src/modules/billing";
import { AsaasGateway } from "../src/modules/billing/infra/asaas.gateway";
import { WebhookProcessorService } from "../src/modules/billing/jobs/webhook-processor.service";

const PASSWORD = "senha-de-teste-bem-comprida";

let ctx: TestApp;
let app: INestApplication;
let mailer: CapturingMailer;

beforeAll(async () => {
  ctx = await createTestApp();
  app = ctx.app;
  mailer = ctx.mailer;
});

afterAll(async () => {
  await ctx.close();
});

const http = () => request(app.getHttpServer());

/** Cria conta + empresa e devolve o token já com a empresa ativa. */
async function newOrganization(prefix: string) {
  const email = uniqueEmail(prefix);

  await http()
    .post("/auth/signup")
    .send({ email, password: PASSWORD, name: `Dono ${prefix}` })
    .expect(201);

  await http()
    .post("/auth/verify-email")
    .send({ token: mailer.lastTokenFor(email) })
    .expect(204);

  const session = await http()
    .post("/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);

  const org = await http()
    .post("/organizations")
    .set("authorization", `Bearer ${session.body.accessToken}`)
    .send({ legalName: `Estúdio ${prefix} LTDA` })
    .expect(201);

  return {
    id: org.body.id as string,
    token: org.body.accessToken as string,
  };
}

// ---------------------------------------------------------------------------

describe("catálogo e assinatura", () => {
  it("a tabela de preços é pública", async () => {
    const res = await http().get("/billing/plans").expect(200);

    expect(res.body).toHaveLength(3);
    expect(res.body.map((p: { key: string }) => p.key)).toEqual([
      "starter",
      "pro",
      "business",
    ]);
  });

  it("inicia trial e materializa os entitlements do plano", async () => {
    const org = await newOrganization("trial");

    const res = await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    expect(res.body.status).toBe("trialing");
    expect(res.body.trialEndsAt).toBeTruthy();

    const atual = await http()
      .get("/billing/subscription")
      .set("authorization", `Bearer ${org.token}`)
      .expect(200);

    expect(atual.body.planKey).toBe("starter");
  });

  it("recusa segunda assinatura viva para a mesma empresa", async () => {
    const org = await newOrganization("dupla");

    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    // Garantido pelo índice parcial subscriptions_one_live_per_org, não por um
    // if — duas requisições simultâneas passariam por qualquer checagem prévia.
    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "pro" })
      .expect(409);
  });

  it("troca de plano recalcula os entitlements", async () => {
    const org = await newOrganization("upgrade");
    const entitlements = app.get(EntitlementsService);

    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    expect(await entitlements.getFeature(org.id, "whatsapp.enabled")).toBe(false);

    await http()
      .post("/billing/change-plan")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "pro" })
      .expect(200);

    // Sem o recálculo, o cliente pagaria o plano novo com os limites do antigo.
    expect(await entitlements.getFeature(org.id, "whatsapp.enabled")).toBe(true);
    expect(
      await entitlements.getFeature(org.id, "appointments.max_per_month"),
    ).toEqual({ limit: 500 });
  });
});

describe("entitlements", () => {
  it("override comercial vence o plano", async () => {
    const org = await newOrganization("cortesia");
    const entitlements = app.get(EntitlementsService);

    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    expect(await entitlements.getFeature(org.id, "whatsapp.enabled")).toBe(false);

    // Cortesia dada pelo comercial. É para isso que a materialização existe:
    // se a resposta viesse do plano, isto seria um `if` no meio do código.
    await forTenant(app.get(PRISMA), org.id, (tx) =>
      tx.organizationEntitlement.create({
        data: {
          organizationId: org.id,
          featureKey: "whatsapp.enabled",
          value: true,
          source: "override",
        },
      }),
    );

    expect(await entitlements.getFeature(org.id, "whatsapp.enabled")).toBe(true);
  });

  /**
   * O critério de pronto do M2: "o limite de plano bloqueia de verdade".
   */
  it("o limite bloqueia quando estoura", async () => {
    const org = await newOrganization("limite");
    const entitlements = app.get(EntitlementsService);

    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    // starter: 100 agendamentos por mês.
    const primeiro = await entitlements.consume(
      org.id,
      "appointments.max_per_month",
      99,
    );
    expect(primeiro).toMatchObject({ allowed: true, used: 99, limit: 100 });

    const cabe = await entitlements.consume(org.id, "appointments.max_per_month", 1);
    expect(cabe).toMatchObject({ allowed: true, used: 100 });

    // 101 não cabe: o incremento atômico não encontra linha para atualizar.
    const estoura = await entitlements.consume(
      org.id,
      "appointments.max_per_month",
      1,
    );
    expect(estoura.allowed).toBe(false);
    expect(estoura.used).toBe(100);
  });

  it("consumo de uma empresa não conta para outra", async () => {
    const a = await newOrganization("uso-a");
    const b = await newOrganization("uso-b");
    const entitlements = app.get(EntitlementsService);

    for (const org of [a, b]) {
      await http()
        .post("/billing/subscribe")
        .set("authorization", `Bearer ${org.token}`)
        .send({ planKey: "starter" })
        .expect(201);
    }

    await entitlements.consume(a.id, "appointments.max_per_month", 50);
    const deB = await entitlements.consume(b.id, "appointments.max_per_month", 1);

    expect(deB.used).toBe(1);
  });
});

describe("webhook do gateway", () => {
  const payload = (eventId: string, subscriptionId: string) => ({
    id: eventId,
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: `pay_${eventId}`,
      subscription: subscriptionId,
      value: 89,
      paymentDate: "2026-07-30",
    },
  });

  it("recusa webhook sem o token do gateway", async () => {
    await http()
      .post("/webhooks/asaas")
      .send(payload("evt_sem_token", "sub_x"))
      .expect(401);
  });

  it("recusa token errado", async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "token-secreto-do-asaas";

    await http()
      .post("/webhooks/asaas")
      .set("asaas-access-token", "token-errado-do-mesmo-tamanho")
      .send(payload("evt_token_errado", "sub_x"))
      .expect(401);
  });

  /**
   * O teste que justifica o unique (provider, event_id).
   *
   * Todo gateway reenvia evento — por timeout, por retry, por falha de rede.
   * Sem a constraint, o reenvio de um PAYMENT_CONFIRMED credita o pagamento
   * duas vezes. Isso é dinheiro, não estética.
   */
  it("evento reenviado é processado uma única vez", async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "token-secreto-do-asaas";

    const org = await newOrganization("webhook");
    await http()
      .post("/billing/subscribe")
      .set("authorization", `Bearer ${org.token}`)
      .send({ planKey: "starter" })
      .expect(201);

    const prisma = app.get(PRISMA);

    const gatewaySubscriptionId = `sub_${Date.now()}`;
    await forTenant(prisma, org.id, async (tx) => {
      const s = await tx.subscription.findFirstOrThrow();
      await tx.subscription.update({
        where: { id: s.id },
        data: { gatewaySubscriptionId, gateway: "asaas" },
      });
    });

    const eventId = `evt_${Date.now()}`;
    const body = payload(eventId, gatewaySubscriptionId);

    const primeira = await http()
      .post("/webhooks/asaas")
      .set("asaas-access-token", "token-secreto-do-asaas")
      .send(body)
      .expect(200);
    expect(primeira.body.status).toBe("processed");

    const reenvio = await http()
      .post("/webhooks/asaas")
      .set("asaas-access-token", "token-secreto-do-asaas")
      .send(body)
      .expect(200);
    expect(reenvio.body.status).toBe("duplicate");

    // Um pagamento, não dois — e a assinatura saiu do trial.
    const pagamentos = await forTenant(prisma, org.id, (tx) =>
      tx.payment.findMany(),
    );
    expect(pagamentos).toHaveLength(1);

    const assinatura = await forTenant(prisma, org.id, (tx) =>
      tx.subscription.findFirstOrThrow(),
    );
    expect(assinatura.status).toBe("active");
  });

  it("compara o token em tempo constante", () => {
    process.env.ASAAS_WEBHOOK_TOKEN = "token-secreto-do-asaas";
    const gateway = app.get(AsaasGateway);

    expect(gateway.verifyWebhook({ "asaas-access-token": "token-secreto-do-asaas" })).toBe(true);
    expect(gateway.verifyWebhook({ "asaas-access-token": "curto" })).toBe(false);
    expect(gateway.verifyWebhook({})).toBe(false);
  });

  it("o processador ignora assinatura desconhecida em vez de estourar", async () => {
    const processor = app.get(WebhookProcessorService);

    const result = await processor.process(
      "asaas",
      {
        eventId: `evt_orfao_${Date.now()}`,
        type: "PAYMENT_CONFIRMED",
        gatewaySubscriptionId: "sub_que_nao_existe",
      },
      {},
    );

    expect(result.status).toBe("ignored");
  });
});
