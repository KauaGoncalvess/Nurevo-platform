import { Module } from "@nestjs/common";
import { AuthController } from "./api/auth.controller";
import { SessionsController } from "./api/sessions.controller";
import { AuthService } from "./application/auth.service";
import { SessionService } from "./application/session.service";
import { SocialAuthService } from "./application/social-auth.service";
import { UserService } from "./application/user.service";
import { MAILER } from "./domain/mailer.port";
import { SOCIAL_PROVIDERS } from "./domain/social-provider.port";
import { DevMailer } from "./infra/dev-mailer";
import { GoogleProvider } from "./infra/google-provider";

@Module({
  controllers: [AuthController, SessionsController],
  providers: [
    AuthService,
    SessionService,
    SocialAuthService,
    UserService,
    GoogleProvider,
    { provide: MAILER, useClass: resolveMailer() },
    {
      provide: SOCIAL_PROVIDERS,
      useFactory: (google: GoogleProvider) => [google],
      inject: [GoogleProvider],
    },
  ],
  exports: [UserService],
})
export class IdentityModule {}

/**
 * Em produção o DevMailer imprimiria links de redefinição de senha no log —
 * uma credencial de acesso à conta, em texto claro, num lugar que costuma ser
 * agregado e compartilhado. Melhor não subir do que subir assim.
 */
function resolveMailer(): typeof DevMailer {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Nenhum provedor de e-mail configurado. O DevMailer escreve links de " +
        "reset no log e não pode rodar em produção (ver M4: outbox + provedor).",
    );
  }

  return DevMailer;
}
