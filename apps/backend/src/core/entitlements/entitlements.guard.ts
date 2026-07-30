import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { requireAuthContext } from "../auth/auth-context";
import { ENTITLEMENT_RESOLVER } from "./entitlement-resolver.port";
import type { EntitlementResolver } from "./entitlement-resolver.port";
import { REQUIRED_FEATURES, REQUIRED_MODULE } from "./entitlements.decorators";

export class PaymentRequiredException extends HttpException {
  constructor(message: string) {
    super(
      { statusCode: HttpStatus.PAYMENT_REQUIRED, message, error: "Payment Required" },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Guard global de entitlements.
 *
 * Responde 402 Payment Required, não 403. A distinção é útil para o cliente:
 * 403 significa "peça acesso a quem administra a empresa"; 402 significa
 * "faça upgrade do plano". Mandar os dois casos para a mesma tela produz
 * suporte desnecessário.
 */
@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ENTITLEMENT_RESOLVER)
    private readonly resolver: EntitlementResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const moduleKey = this.reflector.getAllAndOverride<string>(
      REQUIRED_MODULE,
      targets,
    );
    const features = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_FEATURES,
      targets,
    );

    if (!moduleKey && (!features || features.length === 0)) return true;

    const { organizationId } = requireAuthContext();
    if (!organizationId) {
      throw new ForbiddenException("Nenhuma empresa ativa na sessão.");
    }

    if (moduleKey && !(await this.resolver.hasModule(organizationId, moduleKey))) {
      throw new PaymentRequiredException(
        `O módulo "${moduleKey}" não está incluído no plano atual.`,
      );
    }

    for (const featureKey of features ?? []) {
      const value = await this.resolver.getFeature(organizationId, featureKey);
      if (value !== true) {
        throw new PaymentRequiredException(
          `O recurso "${featureKey}" não está incluído no plano atual.`,
        );
      }
    }

    return true;
  }
}
