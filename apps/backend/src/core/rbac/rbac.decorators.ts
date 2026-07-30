import { SetMetadata } from "@nestjs/common";

export const REQUIRED_PERMISSIONS = "rbac:permissions";

/**
 * Exige as permissões listadas na empresa ativa. Todas, não qualquer uma —
 * "qualquer uma" costuma ser o que alguém queria dizer quando escreveu a regra
 * errada, e o modo estrito falha para o lado seguro.
 *
 * Convenção `recurso:ação`, doc 03 tabela 9.
 */
export const RequiresPermission = (
  ...permissions: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
