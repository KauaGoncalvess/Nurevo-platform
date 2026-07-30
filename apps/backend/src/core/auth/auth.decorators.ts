import { SetMetadata, createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { requireAuthContext } from "./auth-context";

export const IS_PUBLIC = "auth:public";

/**
 * Marca a rota como acessível sem autenticação.
 *
 * O AuthGuard é GLOBAL: o padrão é exigir token, e abrir é o ato explícito.
 * O inverso — guard por rota — faz uma rota nova nascer desprotegida por
 * esquecimento, que é como a maioria dos vazamentos acontece.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string => requireAuthContext().userId,
);
