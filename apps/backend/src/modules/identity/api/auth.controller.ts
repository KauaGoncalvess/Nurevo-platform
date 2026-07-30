import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public, CurrentUser } from "../../../core/auth/auth.decorators";
import { ZodPipe } from "../../../core/http/zod-validation.pipe";
import { AuthService } from "../application/auth.service";
import { SessionService } from "../application/session.service";
import { SocialAuthService } from "../application/social-auth.service";
import { UserService } from "../application/user.service";
import type { UserProfile } from "../application/user.service";
import {
  loginSchema,
  refreshSchema,
  requestResetSchema,
  resetPasswordSchema,
  signupSchema,
  socialLoginSchema,
  verifyEmailSchema,
} from "./auth.dto";
import type {
  LoginInput,
  RefreshInput,
  RequestResetInput,
  ResetPasswordInput,
  SignupInput,
  SocialLoginInput,
  VerifyEmailInput,
} from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly social: SocialAuthService,
    private readonly users: UserService,
  ) {}

  @Public()
  @Post("signup")
  @HttpCode(201)
  signup(@Body(new ZodPipe(signupSchema)) body: SignupInput) {
    return this.auth.signup(body);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request) {
    return this.auth.login({ ...body, ...meta(req) });
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body(new ZodPipe(refreshSchema)) body: RefreshInput,
    @Req() req: Request,
  ) {
    return this.sessions.refresh(body.refreshToken, meta(req));
  }

  @Public()
  @Post("verify-email")
  @HttpCode(204)
  async verifyEmail(
    @Body(new ZodPipe(verifyEmailSchema)) body: VerifyEmailInput,
  ): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  /**
   * 202 mesmo quando o e-mail não existe. Ver requestPasswordReset() —
   * responder 404 aqui entregaria quais e-mails têm conta.
   */
  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  async forgotPassword(
    @Body(new ZodPipe(requestResetSchema)) body: RequestResetInput,
  ): Promise<{ status: string }> {
    await this.auth.requestPasswordReset(body.email);
    return { status: "accepted" };
  }

  @Public()
  @Post("password/reset")
  @HttpCode(204)
  async resetPassword(
    @Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Public()
  @Post("social")
  @HttpCode(200)
  socialLogin(
    @Body(new ZodPipe(socialLoginSchema)) body: SocialLoginInput,
    @Req() req: Request,
  ) {
    return this.social.authenticate(body.provider, body.credential, meta(req));
  }

  @Get("me")
  me(@CurrentUser() userId: string): Promise<UserProfile> {
    return this.users.profile(userId);
  }
}

function meta(req: Request): { ip?: string; userAgent?: string } {
  return {
    ip: req.ip,
    userAgent: req.header("user-agent")?.slice(0, 500),
  };
}
