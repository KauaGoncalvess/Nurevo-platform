import { z } from "zod";

/**
 * Mínimo de 12 caracteres e nenhuma regra de composição.
 *
 * Exigir maiúscula/número/símbolo produz `Senha@123` — curta, previsível e
 * presente em toda lista de senhas vazadas. Comprimento é o que realmente move
 * a entropia, e é a recomendação atual do NIST.
 */
const password = z
  .string()
  .min(12, "A senha precisa de pelo menos 12 caracteres.")
  .max(256);

export const signupSchema = z.object({
  email: z.string().email().max(320),
  password,
  name: z.string().trim().min(2).max(120),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const requestResetSchema = z.object({
  email: z.string().email().max(320),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password,
});

export const socialLoginSchema = z.object({
  provider: z.enum(["google", "apple", "microsoft", "github"]),
  credential: z.string().min(1),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type RequestResetInput = z.infer<typeof requestResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SocialLoginInput = z.infer<typeof socialLoginSchema>;
