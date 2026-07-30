import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module";
import { MAILER } from "../../src/modules/identity/domain/mailer.port";
import type { MailerPort, OutgoingEmail } from "../../src/modules/identity/domain/mailer.port";

/**
 * Captura os e-mails em vez de enviá-los, para que o teste consiga ler o token
 * de verificação e o de reset. É a mesma porta que o DevMailer implementa —
 * substituir a implementação sem tocar no fluxo é exatamente o motivo de a porta
 * existir.
 */
export class CapturingMailer implements MailerPort {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  /** Extrai o `?token=` do último e-mail enviado para o endereço. */
  lastTokenFor(to: string): string {
    const email = [...this.sent].reverse().find((e) => e.to === to);
    if (!email) throw new Error(`Nenhum e-mail enviado para ${to}`);

    const match = /token=([^\s&]+)/.exec(email.body);
    if (!match) throw new Error(`E-mail para ${to} não contém token: ${email.body}`);

    return match[1]!;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export interface TestApp {
  app: INestApplication;
  mailer: CapturingMailer;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const mailer = new CapturingMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    mailer,
    close: async () => {
      await app.close();
    },
  };
}

let counter = 0;

/** E-mail único por execução: os testes rodam contra um banco persistente. */
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@exemplo.test`;
}
