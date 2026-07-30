export type SocialProviderKey = "google" | "apple" | "microsoft" | "github";

export interface SocialProfile {
  provider: SocialProviderKey;
  providerUserId: string;
  email: string;
  /** O provedor afirma ter verificado este e-mail? Decide se dá para vincular. */
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
}

/**
 * Troca o código/credencial do provedor por um perfil já verificado.
 *
 * A implementação valida assinatura e audiência do token do provedor. Retornar
 * um perfil daqui é afirmar "essa pessoa provou ser este usuário no provedor X".
 */
export interface SocialProviderPort {
  readonly key: SocialProviderKey;
  verify(credential: string): Promise<SocialProfile>;
}

export const SOCIAL_PROVIDERS = Symbol("SOCIAL_PROVIDERS");
