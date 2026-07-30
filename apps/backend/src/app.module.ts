import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./core/auth/auth.guard";
import { AuthModule } from "./core/auth/auth.module";
import { DatabaseModule } from "./core/database/database.module";
import { HealthController } from "./core/health/health.controller";
import { PermissionsGuard } from "./core/rbac/permissions.guard";
import { TenantMiddleware } from "./core/tenant/tenant.middleware";
import { IdentityModule } from "./modules/identity";
import { OrganizationsModule } from "./modules/organizations";

@Module({
  imports: [DatabaseModule, AuthModule, IdentityModule, OrganizationsModule],
  controllers: [HealthController],
  providers: [
    // Guards GLOBAIS: o padrão é exigir autenticação, e abrir é o ato explícito
    // (@Public). O inverso faria toda rota nova nascer desprotegida por
    // esquecimento — que é como a maioria dos vazamentos acontece.
    //
    // A ordem importa: AuthGuard antes de PermissionsGuard, para que "não
    // autenticado" responda 401 e não 403.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Em TODAS as rotas. O middleware apenas resolve o contexto a partir do
    // token; quem exige contexto são os guards. Aplicar seletivamente é como se
    // esquece uma rota nova.
    consumer.apply(TenantMiddleware).forRoutes("*path");
  }
}
