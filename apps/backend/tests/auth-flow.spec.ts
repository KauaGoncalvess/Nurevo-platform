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

async function signupAndVerify(email: string) {
  await http()
    .post("/auth/signup")
    .send({ email, password: PASSWORD, name: "Pessoa Teste" })
    .expect(201);

  await http()
    .post("/auth/verify-email")
    .send({ token: mailer.lastTokenFor(email) })
    .expect(204);
}

async function login(email: string) {
  const res = await http()
    .post("/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);

  return res.body as { accessToken: string; refreshToken: string };
}

// ---------------------------------------------------------------------------

describe("cadastro e verificação de e-mail", () => {
  it("exige e-mail confirmado antes do primeiro login", async () => {
    const email = uniqueEmail("novato");

    await http()
      .post("/auth/signup")
      .send({ email, password: PASSWORD, name: "Novato" })
      .expect(201);

    // Conta existe e a senha está certa, mas o e-mail não foi confirmado.
    await http().post("/auth/login").send({ email, password: PASSWORD }).expect(401);

    await http()
      .post("/auth/verify-email")
      .send({ token: mailer.lastTokenFor(email) })
      .expect(204);

    await http().post("/auth/login").send({ email, password: PASSWORD }).expect(200);
  });

  it("recusa e-mail já cadastrado", async () => {
    const email = uniqueEmail("duplicado");
    await signupAndVerify(email);

    await http()
      .post("/auth/signup")
      .send({ email, password: PASSWORD, name: "Outro" })
      .expect(409);
  });

  it("recusa senha curta antes de tocar no banco", async () => {
    await http()
      .post("/auth/signup")
      .send({ email: uniqueEmail("fraco"), password: "123", name: "Fraco" })
      .expect(400);
  });

  it("o link de verificação não pode ser usado duas vezes", async () => {
    const email = uniqueEmail("replay");
    await http()
      .post("/auth/signup")
      .send({ email, password: PASSWORD, name: "Replay" })
      .expect(201);

    const token = mailer.lastTokenFor(email);
    await http().post("/auth/verify-email").send({ token }).expect(204);
    await http().post("/auth/verify-email").send({ token }).expect(400);
  });
});

describe("login", () => {
  it("responde igual para senha errada e para e-mail inexistente", async () => {
    const email = uniqueEmail("existente");
    await signupAndVerify(email);

    const senhaErrada = await http()
      .post("/auth/login")
      .send({ email, password: "senha-errada-mas-longa" })
      .expect(401);

    const inexistente = await http()
      .post("/auth/login")
      .send({ email: uniqueEmail("fantasma"), password: PASSWORD })
      .expect(401);

    // Diferenciar as duas entregaria uma lista de e-mails cadastrados a quem
    // estiver testando credenciais vazadas de outro site.
    expect(senhaErrada.body.message).toBe(inexistente.body.message);
  });
});

describe("rotação de refresh token", () => {
  it("rotaciona e invalida o token anterior", async () => {
    const email = uniqueEmail("rotacao");
    await signupAndVerify(email);
    const first = await login(email);

    const res = await http()
      .post("/auth/refresh")
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    const second = res.body as { accessToken: string; refreshToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  /**
   * O teste que justifica a existência de family_id.
   *
   * Reusar um refresh já rotacionado significa que alguém copiou o token. Como
   * não dá para saber quem é o legítimo, a resposta certa é derrubar a família
   * inteira — inclusive o token novo, que estava nas mãos de um dos dois.
   */
  it("reuso de token revogado derruba a família inteira", async () => {
    const email = uniqueEmail("reuso");
    await signupAndVerify(email);
    const first = await login(email);

    const res = await http()
      .post("/auth/refresh")
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    const second = res.body as { refreshToken: string };

    // O ladrão (ou o cliente confuso) apresenta o token velho.
    await http()
      .post("/auth/refresh")
      .send({ refreshToken: first.refreshToken })
      .expect(401);

    // E o token novo, que ainda era válido, também morre. É esse o ponto:
    // sem isso, quem roubou o token continuaria dentro para sempre.
    await http()
      .post("/auth/refresh")
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });
});

describe("redefinição de senha", () => {
  it("troca a senha e derruba todas as sessões existentes", async () => {
    const email = uniqueEmail("reset");
    await signupAndVerify(email);
    const session = await login(email);

    await http().post("/auth/password/forgot").send({ email }).expect(202);

    const novaSenha = "outra-senha-bem-comprida";
    await http()
      .post("/auth/password/reset")
      .send({ token: mailer.lastTokenFor(email), password: novaSenha })
      .expect(204);

    // Quem redefine senha costuma estar reagindo a um acesso indevido. Se a
    // sessão antiga sobrevivesse, o invasor continuaria dentro.
    await http()
      .post("/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    await http().post("/auth/login").send({ email, password: novaSenha }).expect(200);
    await http().post("/auth/login").send({ email, password: PASSWORD }).expect(401);
  });

  it("responde 202 para e-mail que não existe", async () => {
    await http()
      .post("/auth/password/forgot")
      .send({ email: uniqueEmail("nao-existe") })
      .expect(202);
  });
});

describe("rotas protegidas", () => {
  it("/auth/me exige token", async () => {
    await http().get("/auth/me").expect(401);
  });

  it("/auth/me devolve o perfil do dono do token", async () => {
    const email = uniqueEmail("perfil");
    await signupAndVerify(email);
    const session = await login(email);

    const res = await http()
      .get("/auth/me")
      .set("authorization", `Bearer ${session.accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({ email, emailVerified: true });
  });

  it("token forjado é rejeitado", async () => {
    await http()
      .get("/auth/me")
      .set("authorization", "Bearer nao.e.um.token")
      .expect(401);
  });

  it("health continua público", async () => {
    await http().get("/health").expect(200);
  });
});
