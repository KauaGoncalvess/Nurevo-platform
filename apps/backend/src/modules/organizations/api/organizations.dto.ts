import { z } from "zod";

export const createOrganizationSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().min(2).max(200).optional(),
  document: z.string().trim().max(20).optional(),
  timezone: z.string().trim().max(60).optional(),
});

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

export const inviteSchema = z.object({
  email: z.string().email().max(320),
  // `owner` fora da lista de propósito: transferir a propriedade da empresa é um
  // fluxo próprio, com confirmação, não um convite comum.
  roleKey: z.enum(["admin", "staff", "viewer"]),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
