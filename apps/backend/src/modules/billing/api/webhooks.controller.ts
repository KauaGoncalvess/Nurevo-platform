import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../../../core/auth/auth.decorators";
import { PAYMENT_GATEWAY } from "../domain/payment-gateway.port";
import type { PaymentGateway } from "../domain/payment-gateway.port";
import { WebhookProcessorService } from "../jobs/webhook-processor.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly processor: WebhookProcessorService,
  ) {}

  /**
   * Rota pública por necessidade — quem chama é o gateway, não um usuário. A
   * autenticação é o token do header, conferido em tempo constante.
   *
   * Sempre 200 quando o evento é aceito, inclusive em duplicata. Responder erro
   * a um reenvio faz o gateway tentar de novo em laço, e o evento já foi tratado.
   */
  @Public()
  @Post("asaas")
  @HttpCode(200)
  async asaas(
    @Req() req: Request,
    @Body() payload: unknown,
  ): Promise<{ status: string }> {
    if (!this.gateway.verifyWebhook(req.headers as Record<string, string>)) {
      // Sem isto, qualquer um que descubra a URL marca faturas como pagas.
      throw new UnauthorizedException("Webhook não autenticado.");
    }

    const event = this.gateway.parseWebhook(payload);
    if (!event) return { status: "ignored" };

    return this.processor.process(this.gateway.name, event, payload);
  }
}
