/**
 * Porta de entitlements — mesma inversão de dependência do PERMISSION_RESOLVER.
 *
 * `core/entitlements` responde "esse tenant PODE usar isso?"; quem sabe a
 * resposta é `modules/billing`. Como core não pode importar de modules (regra 3
 * do doc 02), core declara a interface e billing a implementa.
 *
 * Distinção que importa: RBAC pergunta "esta PESSOA pode fazer isso?";
 * entitlement pergunta "esta EMPRESA comprou isso?". Um viewer e um owner têm
 * o mesmo entitlement; o que muda entre eles é permissão.
 */
export type EntitlementValue = boolean | { limit: number };

export interface ConsumeResult {
  allowed: boolean;
  used: number;
  limit: number | null;
}

export interface EntitlementResolver {
  /** O plano da empresa inclui este módulo vendável? */
  hasModule(organizationId: string, moduleKey: string): Promise<boolean>;

  /** Valor atual da feature, já considerando overrides comerciais. */
  getFeature(
    organizationId: string,
    featureKey: string,
  ): Promise<EntitlementValue | null>;

  /**
   * Incrementa o consumo do período e diz se coube no limite. Atômico: checar e
   * depois gravar perde a corrida entre duas requisições simultâneas.
   */
  consume(
    organizationId: string,
    featureKey: string,
    amount: number,
  ): Promise<ConsumeResult>;

  invalidate(organizationId: string): void;
}

export const ENTITLEMENT_RESOLVER = Symbol("ENTITLEMENT_RESOLVER");
