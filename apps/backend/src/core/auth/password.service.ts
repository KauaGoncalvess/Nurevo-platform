import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id — vencedor da Password Hashing Competition e recomendação atual da
 * OWASP. bcrypt continua aceitável, mas trunca em 72 bytes e não resiste a
 * ataque com GPU/ASIC tão bem quanto argon2id, que é memory-hard.
 *
 * Parâmetros: OWASP mínimo (19 MiB, 2 iterações, paralelismo 1). O custo real é
 * dominado pela memória, não pelo tempo de CPU.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  /**
   * Retorna false em vez de propagar erro quando o hash é inválido ou ausente.
   *
   * Conta criada por login social tem password_hash NULL. Se isso estourasse, a
   * mensagem de erro distinguiria "conta existe mas sem senha" de "conta não
   * existe" — que é justamente o vazamento que o fluxo de login evita.
   */
  async verify(hashed: string | null, plain: string): Promise<boolean> {
    if (!hashed) return false;
    try {
      return await verify(hashed, plain, OPTIONS);
    } catch {
      return false;
    }
  }
}
