import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { assertDevFallbackDisabled } from "./core/tenant/tenant.middleware";

async function bootstrap(): Promise<void> {
  // Antes de abrir a porta: se a configuração permitir trocar de tenant por
  // header em produção, o processo não sobe.
  assertDevFallbackDisabled();

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3333);

  await app.listen(port);
  new Logger("bootstrap").log(`Nurevo backend em http://localhost:${port}`);
}

void bootstrap();
