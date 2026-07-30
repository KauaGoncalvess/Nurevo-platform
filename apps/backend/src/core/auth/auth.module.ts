import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

/**
 * Global porque TokenService é usado pelo TenantMiddleware, que é registrado no
 * AppModule, e pelo modules/identity. Não carrega regra de negócio — só emissão
 * e verificação de credencial.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: requireJwtSecret(),
      // O tipo de expiresIn é um template literal ("15m", "7d"...). Validar em
      // runtime seria duplicar o parser do jsonwebtoken sem ganho — o valor vem
      // de variável de ambiente e um formato inválido derruba o boot.
      signOptions: {
        expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as `${number}m`,
      },
    }),
  ],
  providers: [TokenService, PasswordService],
  exports: [TokenService, PasswordService],
})
export class AuthModule {}

/**
 * Falta de segredo derruba o boot em vez de gerar tokens com um default.
 * Um segredo padrão em produção significa que qualquer um assina um token
 * válido para qualquer usuário de qualquer empresa.
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET não definida. Gere com: openssl rand -base64 32",
    );
  }

  if (process.env.NODE_ENV === "production" && secret.includes("troque-isto")) {
    throw new Error(
      "JWT_SECRET ainda é o valor de exemplo do .env.example. " +
        "Em produção isso permite forjar token de qualquer usuário.",
    );
  }

  return secret;
}
