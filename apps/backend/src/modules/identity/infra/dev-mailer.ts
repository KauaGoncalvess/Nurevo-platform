import { Injectable, Logger } from "@nestjs/common";
import type { MailerPort, OutgoingEmail } from "../domain/mailer.port";

/**
 * Implementação de desenvolvimento: escreve o e-mail no log em vez de enviar.
 *
 * Isso torna o fluxo de verificação e de reset testável ponta a ponta sem
 * provedor externo. Em produção, o boot falha se esta for a implementação ativa
 * (ver identity.module.ts) — um link de reset de senha impresso no log de
 * produção é um vazamento de credencial.
 */
@Injectable()
export class DevMailer implements MailerPort {
  private readonly logger = new Logger(DevMailer.name);

  async send(email: OutgoingEmail): Promise<void> {
    this.logger.log(`[e-mail simulado] para=${email.to} · ${email.subject}`);
    this.logger.log(email.body);
  }
}
