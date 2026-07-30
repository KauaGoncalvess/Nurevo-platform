import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../../../core/auth/auth.decorators";
import { TokenService } from "../../../core/auth/token.service";
import { ZodPipe } from "../../../core/http/zod-validation.pipe";
import { MembershipsService } from "../application/memberships.service";
import type { MembershipSummary } from "../application/memberships.service";
import { OnboardingService } from "../application/onboarding.service";
import type { CreatedOrganization } from "../application/onboarding.service";
import {
  createOrganizationSchema,
  switchOrganizationSchema,
} from "./organizations.dto";
import type {
  CreateOrganizationInput,
  SwitchOrganizationInput,
} from "./organizations.dto";

@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly memberships: MembershipsService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Sem @RequiresPermission: quem cria a empresa ainda não é membro de nenhuma,
   * então não há permissão a exigir. É o primeiro passo do onboarding.
   */
  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ): Promise<CreatedOrganization & { accessToken: string }> {
    const organization = await this.onboarding.createOrganization({
      userId,
      ...body,
    });

    // Já devolve o token com a empresa ativa: sem isso o cliente teria que
    // pedir a troca logo em seguida, e o onboarding ganharia um passo à toa.
    return {
      ...organization,
      accessToken: this.tokens.signAccessToken({
        sub: userId,
        org: organization.id,
      }),
    };
  }

  @Get("mine")
  listMine(@CurrentUser() userId: string): Promise<MembershipSummary[]> {
    return this.memberships.listForUser(userId);
  }

  /**
   * Trocar de empresa emite um access token novo com outro `org`.
   *
   * A membership é verificada aqui, no momento da emissão — é isto que impede
   * alguém de pedir um token para uma empresa de que não participa. Uma vez
   * emitido, o token é a autoridade: por isso ele é curto.
   */
  @Post("switch")
  @HttpCode(200)
  async switch(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(switchOrganizationSchema)) body: SwitchOrganizationInput,
  ): Promise<{ accessToken: string }> {
    const allowed = await this.memberships.hasActiveMembership(
      userId,
      body.organizationId,
    );

    if (!allowed) {
      // Mesma resposta para "empresa não existe" e "você não é membro": a
      // diferença permitiria descobrir quais ids de empresa existem.
      throw new ForbiddenException("Empresa indisponível.");
    }

    return {
      accessToken: this.tokens.signAccessToken({
        sub: userId,
        org: body.organizationId,
      }),
    };
  }
}
