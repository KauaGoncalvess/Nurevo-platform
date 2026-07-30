import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type {
  SocialProfile,
  SocialProviderKey,
  SocialProviderPort,
} from "../domain/social-provider.port";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

interface GoogleIdToken extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verifica o ID token do Google contra o JWKS público do próprio Google.
 *
 * `audience` é a checagem que costuma ser esquecida e que importa: sem ela, um
 * ID token emitido para OUTRO aplicativo Google qualquer seria aceito aqui —
 * qualquer desenvolvedor com um client id poderia entrar como qualquer pessoa.
 *
 * NOTA DE HONESTIDADE: este adapter não foi exercitado contra o Google de
 * verdade, porque isso exige credencial. O que ESTÁ testado é a parte que
 * concentra o risco — a vinculação de conta em SocialAuthService, coberta com um
 * provider falso. Este arquivo é a borda fina e substituível de propósito.
 */
@Injectable()
export class GoogleProvider implements SocialProviderPort {
  readonly key: SocialProviderKey = "google";

  private readonly jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

  async verify(credential: string): Promise<SocialProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new UnauthorizedException("Login com Google não está configurado.");
    }

    let payload: GoogleIdToken;
    try {
      const result = await jwtVerify(credential, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
      });
      payload = result.payload as GoogleIdToken;
    } catch {
      throw new UnauthorizedException("Credencial do Google inválida.");
    }

    if (!payload.email) {
      throw new UnauthorizedException("O Google não retornou um e-mail.");
    }

    return {
      provider: "google",
      providerUserId: payload.sub,
      email: payload.email,
      // Repassado como veio. Quem decide o que fazer com um e-mail não
      // verificado é SocialAuthService — e o que ele faz é recusar a vinculação.
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email,
      avatarUrl: payload.picture,
    };
  }
}
