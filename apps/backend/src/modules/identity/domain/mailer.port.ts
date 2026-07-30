export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Porta de envio de e-mail.
 *
 * O V1 usa a implementação de desenvolvimento, que apenas registra o link no log.
 * O provedor real entra no M4 junto com a tabela `notifications` (doc 03, 27) —
 * e vai entrar como OUTBOX, não como chamada direta: gravar a linha e deixar o
 * worker enviar é o que dá retry e evita e-mail enviado dentro de uma transação
 * que depois sofre rollback.
 *
 * Manter a porta desde já é o que torna essa troca um arquivo novo, não uma
 * refatoração de todo o fluxo de cadastro.
 */
export interface MailerPort {
  send(email: OutgoingEmail): Promise<void>;
}

export const MAILER = Symbol("MAILER");
