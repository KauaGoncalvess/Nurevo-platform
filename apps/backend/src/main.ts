import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  // As checagens de configuração que derrubam o boot ficam nos módulos que as
  // entendem: JWT_SECRET em core/auth, provedor de e-mail em modules/identity.
  // Falhar ao subir é melhor que subir inseguro e descobrir em produção.
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3333);

  await app.listen(port);
  new Logger("bootstrap").log(`Nurevo backend em http://localhost:${port}`);
}

void bootstrap();
