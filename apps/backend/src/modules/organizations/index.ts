/**
 * Contrato PÚBLICO do módulo organizations (doc 02).
 *
 * O que sai daqui é o que outros módulos podem usar. Repositórios, entidades
 * Prisma e controllers ficam de fora por desenho — o lint bloqueia quem tentar
 * importá-los direto, e é essa restrição que mantém a extração possível.
 */
export { OrganizationsModule } from "./organizations.module";
export { BranchesService } from "./application/branches.service";
export type { BranchSummary } from "./application/branches.service";
