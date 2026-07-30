import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

/**
 * Claims do access token.
 *
 * `org` é OPCIONAL de propósito: entre o cadastro e a criação da empresa o
 * usuário está autenticado mas não tem tenant. É o TenantGuard que barra as
 * rotas de domínio nesse intervalo, não a ausência de token.
 *
 * O que NÃO entra aqui, e por quê:
 *
 * - Permissões. Se entrassem, remover alguém de um cargo só teria efeito quando
 *   o token expirasse. São resolvidas por requisição, com cache curto.
 * - membership_id. Seria um atalho para evitar uma consulta, mas viraria claim
 *   obsoleta assim que a membership fosse suspensa ou removida. O resolver
 *   precisa checar o status de qualquer forma.
 */
export interface AccessTokenClaims {
  sub: string;
  org?: string;
}

export interface IssuedRefreshToken {
  /** Valor em claro — vai para o cliente e nunca é persistido. */
  token: string;
  /** O que é gravado em refresh_tokens.token_hash. */
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwt.sign(claims);
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const claims = this.tryVerifyAccessToken(token);
    if (!claims) {
      throw new UnauthorizedException("Token inválido ou expirado.");
    }
    return claims;
  }

  /**
   * Verificação silenciosa, para o TenantMiddleware.
   *
   * O middleware roda em TODAS as rotas, inclusive nas públicas. Token ausente
   * ou expirado ali não é erro — é só ausência de contexto, e quem decide se a
   * rota exigia contexto é o guard, depois.
   */
  tryVerifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      return this.jwt.verify<AccessTokenClaims>(token);
    } catch {
      return null;
    }
  }

  /**
   * Gera um refresh token opaco.
   *
   * Não é JWT de propósito: precisa ser revogável, e JWT revogável exige
   * consultar o banco de qualquer jeito — então o formato assinado só somaria
   * tamanho e a ilusão de que dá para confiar sem consultar.
   *
   * `familyId` herdado mantém a linhagem na rotação. Ver RefreshToken no doc 03:
   * apresentar um token já revogado invalida a família inteira.
   */
  issueRefreshToken(familyId?: string, ttlDays = 30): IssuedRefreshToken {
    const token = randomBytes(32).toString("base64url");

    return {
      token,
      tokenHash: hashToken(token),
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
    };
  }
}

/**
 * SHA-256 sem salt, de propósito.
 *
 * Diferente de senha, o token tem 256 bits de entropia aleatória — não há
 * dicionário nem rainbow table que ajude, então argon2 aqui só adicionaria
 * latência a cada refresh. O que importa é o banco guardar o hash: vazamento da
 * tabela não entrega a sessão de ninguém.
 *
 * Também usado nos tokens de convite e de verificação de e-mail, pelo mesmo motivo.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
