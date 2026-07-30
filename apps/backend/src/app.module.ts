import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { DatabaseModule } from "./core/database/database.module";
import { HealthController } from "./core/health/health.controller";
import { TenantMiddleware } from "./core/tenant/tenant.middleware";
import { OrganizationsModule } from "./modules/organizations";

@Module({
  imports: [DatabaseModule, OrganizationsModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Em TODAS as rotas. O middleware só popula o contexto; quem exige tenant é
    // o código de domínio, via withTenant(). Aplicar seletivamente é como se
    // esquece uma rota nova.
    consumer.apply(TenantMiddleware).forRoutes("*path");
  }
}
