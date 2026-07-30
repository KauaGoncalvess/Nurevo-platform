/**
 * Contrato PÚBLICO do módulo identity (doc 02).
 *
 * Sai daqui só leitura de perfil. Credenciais, tokens e sessões NÃO são
 * exportados: nenhum outro módulo tem motivo para tocar em hash de senha ou
 * emitir sessão, e o que não é exportado não pode ser mal usado.
 *
 * Eventos publicados: nenhum ainda. `user.registered` entra quando houver
 * consumidor real (M4, notificações).
 */
export { IdentityModule } from "./identity.module";
export { UserService } from "./application/user.service";
export type { UserProfile } from "./application/user.service";
