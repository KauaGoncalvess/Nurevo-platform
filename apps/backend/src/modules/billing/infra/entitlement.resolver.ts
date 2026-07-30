import { Injectable } from "@nestjs/common";
import type {
  ConsumeResult,
  EntitlementResolver,
  EntitlementValue,
} from "../../../core/entitlements/entitlement-resolver.port";
import { EntitlementsService } from "../application/entitlements.service";

const TTL_MS = 5 * 60 * 1000;

/**
 * Implementação de ENTITLEMENT_RESOLVER (core/entitlements).
 *
 * O doc 03 pede cache em Redis com TTL de 5 min. Aqui é EM MEMÓRIA, com o mesmo
 * TTL, e a razão é escopo: o V1 roda em instância única no Coolify, e subir
 * Redis para um consumidor só é infraestrutura sem uso.
 *
 * O que muda ao escalar horizontalmente, e precisa estar escrito: invalidate()
 * só afeta a instância que atendeu a troca de plano. As outras continuam
 * servindo o entitlement antigo por até 5 minutos — um cliente que fez upgrade
 * veria o limite velho de forma intermitente, dependendo de qual instância
 * atendesse. Nesse momento isto vira Redis, com a chave `org:{id}:entitlements`
 * do doc 01.
 *
 * `consume()` NÃO é cacheado: é escrita, e resolvida atomicamente no banco.
 */
@Injectable()
export class CachedEntitlementResolver implements EntitlementResolver {
  private readonly features = new Map<
    string,
    { value: EntitlementValue | null; expiresAt: number }
  >();
  private readonly modules = new Map<string, { value: boolean; expiresAt: number }>();

  constructor(private readonly entitlements: EntitlementsService) {}

  async hasModule(organizationId: string, moduleKey: string): Promise<boolean> {
    const key = `${organizationId}:${moduleKey}`;
    const cached = this.modules.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.entitlements.hasModule(organizationId, moduleKey);
    this.modules.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  async getFeature(
    organizationId: string,
    featureKey: string,
  ): Promise<EntitlementValue | null> {
    const key = `${organizationId}:${featureKey}`;
    const cached = this.features.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.entitlements.getFeature(organizationId, featureKey);
    this.features.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  }

  consume(
    organizationId: string,
    featureKey: string,
    amount: number,
  ): Promise<ConsumeResult> {
    return this.entitlements.consume(organizationId, featureKey, amount);
  }

  invalidate(organizationId: string): void {
    for (const map of [this.features, this.modules]) {
      for (const key of map.keys()) {
        if (key.startsWith(`${organizationId}:`)) map.delete(key);
      }
    }
  }
}
