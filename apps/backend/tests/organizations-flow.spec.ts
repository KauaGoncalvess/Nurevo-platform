import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp, uniqueEmail } from "./helpers/app";
import type { CapturingMailer, TestApp } from "./helpers/app";

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

interface Account {
  email: string;
  accessToken: string;
  refreshToken: string;
}

async function createAccount(prefix: string): Promise<Account> {
  const email = uniqueEmail(prefix);

  await http()
    .post("/auth/signup")
    .send({ email, password: PASSWORD, name: `Dono ${prefix}` })
    .expect(201);

  await http()
    .post("/auth/verify-email")
    .send({ token: mailer.lastTokenFor(email) })
    .expect(204);

  const res = await http()
    .post("/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);

  return { email, ...(res.body as { accessToken: string; refreshToken: string }) };
}

async function createOrganization(account: Account, legalName: string) {
  const res = await http()
    .post("/organizations")
    .set("authorization", `Bearer ${account.accessToken}`)
    .send({ legalName })
    .expect(201);

  return res.body as {
    id: string;
    slug: string;
    accessToken: string;
  };
}

// ---------------------------------------------------------------------------

describe("onboarding", () => {
  it("cria empresa, filial default e membership de owner numa transação", async () => {
    const owner = await createAccount("onboarding");
    const org = await createOrganization(owner, "Estúdio Alfa LTDA");

    expect(org.id).toBeTruthy();
    expect(org.slug).toMatch(/^estudio-alfa-ltda/);

    // O token devolvido já vem com a empresa ativa: sem isso o onboarding
    // ganharia um passo de troca de empresa logo em seguida.
    const branches = await http()
      .get("/branches")
      .set("authorization", `Bearer ${org.accessToken}`)
      .expect(200);

    expect(branches.body).toHaveLength(1);
    expect(branches.body[0].isDefault).toBe(true);
  });

  it("gera slug alternativo quando o nome colide", async () => {
    const primeiro = await createAccount("colisao-a");
    const segundo = await createAccount("colisao-b");

    const nome = `Estúdio Colisão ${Date.now()}`;
    const a = await createOrganization(primeiro, nome);
    const b = await createOrganization(segundo, nome);

    // O RLS impede CONSULTAR se o slug existe — a colisão só aparece como
    // violação de unicidade, e o serviço tenta o próximo candidato.
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug.startsWith(a.slug)).toBe(true);
  });

  it("token sem empresa não acessa rota de domínio", async () => {
    const semEmpresa = await createAccount("sem-empresa");

    // 403 e não 401: a pessoa ESTÁ autenticada, só não tem empresa ativa.
    // Responder 401 a mandaria para a tela de login onde ela já está logada.
    await http()
      .get("/branches")
      .set("authorization", `Bearer ${semEmpresa.accessToken}`)
      .expect(403);

    // Sem token nenhum, aí sim é 401.
    await http().get("/branches").expect(401);
  });

  it("lista apenas as próprias empresas", async () => {
    const dono = await createAccount("minhas");
    const outro = await createAccount("alheias");

    const minha = await createOrganization(dono, "Minha Empresa LTDA");
    await createOrganization(outro, "Empresa do Outro LTDA");

    // Esta consulta roda sem tenant escolhido — é a política own_memberships,
    // e não o client BYPASSRLS, que a torna possível.
    const res = await http()
      .get("/organizations/mine")
      .set("authorization", `Bearer ${dono.accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].organizationId).toBe(minha.id);
  });
});

describe("convites", () => {
  it("convida, aceita e o convidado passa a enxergar a empresa", async () => {
    const dono = await createAccount("convite-dono");
    const org = await createOrganization(dono, "Estúdio Convite LTDA");
    const convidado = await createAccount("convite-membro");

    const convite = await http()
      .post("/members/invitations")
      .set("authorization", `Bearer ${org.accessToken}`)
      .send({ email: convidado.email, roleKey: "staff" })
      .expect(201);

    // Aceitar acontece antes de haver membership — sem tenant no contexto.
    // Quem destrava a leitura é a política invitation_by_token.
    await http()
      .post("/invitations/accept")
      .set("authorization", `Bearer ${convidado.accessToken}`)
      .send({ token: convite.body.token })
      .expect(200);

    const trocou = await http()
      .post("/organizations/switch")
      .set("authorization", `Bearer ${convidado.accessToken}`)
      .send({ organizationId: org.id })
      .expect(200);

    await http()
      .get("/branches")
      .set("authorization", `Bearer ${trocou.body.accessToken}`)
      .expect(200);
  });

  it("o mesmo convite não pode ser aceito duas vezes", async () => {
    const dono = await createAccount("duplo-dono");
    const org = await createOrganization(dono, "Estúdio Duplo LTDA");
    const convidado = await createAccount("duplo-membro");

    const convite = await http()
      .post("/members/invitations")
      .set("authorization", `Bearer ${org.accessToken}`)
      .send({ email: convidado.email, roleKey: "viewer" })
      .expect(201);

    await http()
      .post("/invitations/accept")
      .set("authorization", `Bearer ${convidado.accessToken}`)
      .send({ token: convite.body.token })
      .expect(200);

    await http()
      .post("/invitations/accept")
      .set("authorization", `Bearer ${convidado.accessToken}`)
      .send({ token: convite.body.token })
      .expect(404);
  });

  it("token de convite inventado não abre nada", async () => {
    const intruso = await createAccount("intruso-convite");

    await http()
      .post("/invitations/accept")
      .set("authorization", `Bearer ${intruso.accessToken}`)
      .send({ token: "token-que-nao-existe" })
      .expect(404);
  });
});

describe("RBAC", () => {
  it("viewer lê membros mas não convida", async () => {
    const dono = await createAccount("rbac-dono");
    const org = await createOrganization(dono, "Estúdio RBAC LTDA");
    const viewer = await createAccount("rbac-viewer");

    const convite = await http()
      .post("/members/invitations")
      .set("authorization", `Bearer ${org.accessToken}`)
      .send({ email: viewer.email, roleKey: "viewer" })
      .expect(201);

    await http()
      .post("/invitations/accept")
      .set("authorization", `Bearer ${viewer.accessToken}`)
      .send({ token: convite.body.token })
      .expect(200);

    const trocou = await http()
      .post("/organizations/switch")
      .set("authorization", `Bearer ${viewer.accessToken}`)
      .send({ organizationId: org.id })
      .expect(200);

    const viewerToken = trocou.body.accessToken as string;

    await http()
      .get("/members")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);

    // RLS diz "esse dado é da empresa X"; RBAC diz "você pode fazer isso dentro
    // da empresa X". Nenhum dos dois substitui o outro (doc 01).
    await http()
      .post("/members/invitations")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ email: uniqueEmail("alvo"), roleKey: "staff" })
      .expect(403);
  });
});

describe("isolamento entre empresas pela API", () => {
  it("um usuário não assume empresa da qual não é membro", async () => {
    const donoA = await createAccount("iso-a");
    const donoB = await createAccount("iso-b");

    const orgA = await createOrganization(donoA, "Estúdio A LTDA");
    const orgB = await createOrganization(donoB, "Estúdio B LTDA");

    // Conhecer o uuid da empresa não dá acesso a ela.
    await http()
      .post("/organizations/switch")
      .set("authorization", `Bearer ${donoA.accessToken}`)
      .send({ organizationId: orgB.id })
      .expect(403);

    const deA = await http()
      .get("/branches")
      .set("authorization", `Bearer ${orgA.accessToken}`)
      .expect(200);

    const deB = await http()
      .get("/branches")
      .set("authorization", `Bearer ${orgB.accessToken}`)
      .expect(200);

    expect(deA.body).toHaveLength(1);
    expect(deB.body).toHaveLength(1);
    expect(deA.body[0].id).not.toBe(deB.body[0].id);
  });

  it("o header x-organization-id do M0 não existe mais", async () => {
    const conta = await createAccount("header-morto");
    const org = await createOrganization(conta, "Estúdio Header LTDA");

    // Um usuário sem empresa forjando o header não vira membro de ninguém.
    const semEmpresa = await createAccount("header-forjado");

    await http()
      .get("/branches")
      .set("authorization", `Bearer ${semEmpresa.accessToken}`)
      .set("x-organization-id", org.id)
      .expect(403);
  });
});
