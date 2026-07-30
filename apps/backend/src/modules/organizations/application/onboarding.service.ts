import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { Prisma, PrismaClient, forTenant } from "@nurevo/database";
import { PRISMA } from "../../../core/database/database.module";

export interface CreatedOrganization {
  id: string;
  slug: string;
  legalName: string;
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Cadastro da empresa: organização + filial default + membership de owner,
   * tudo numa transação.
   *
   * O id é gerado ANTES do insert e a transação já abre fixada nele. Não é
   * firula: a política de `organizations` exige `id = current_organization_id()`
   * no WITH CHECK, então não existe "criar primeiro, escolher o tenant depois".
   * O caminho de criação passa pelo mesmo RLS que todo o resto.
   *
   * Filial default criada aqui porque `appointments` já nasce com `branch_id`
   * (doc 03, tabela 6). Adicionar filial depois, com agendamentos existentes,
   * seria migration de dados.
   */
  async createOrganization(input: {
    userId: string;
    legalName: string;
    tradeName?: string;
    document?: string;
    timezone?: string;
  }): Promise<CreatedOrganization> {
    const id = await this.newId();
    const ownerRoleId = await this.systemRoleId(id, "owner");

    for (const slug of slugCandidates(input.tradeName ?? input.legalName)) {
      try {
        return await forTenant(
          this.prisma,
          id,
          async (tx) => {
            const organization = await tx.organization.create({
              data: {
                id,
                slug,
                legalName: input.legalName.trim(),
                tradeName: input.tradeName?.trim() ?? null,
                document: input.document ?? null,
                timezone: input.timezone ?? "America/Sao_Paulo",
              },
            });

            await tx.branch.create({
              data: {
                organizationId: id,
                name: organization.tradeName ?? "Unidade principal",
                isDefault: true,
              },
            });

            await tx.membership.create({
              data: {
                organizationId: id,
                userId: input.userId,
                roleId: ownerRoleId,
                status: "active",
                joinedAt: new Date(),
              },
            });

            return {
              id: organization.id,
              slug: organization.slug,
              legalName: organization.legalName,
            };
          },
          input.userId,
        );
      } catch (error) {
        // Consequência do RLS que vale registrar: não dá para CONSULTAR se um
        // slug já existe, porque o tenant não enxerga organizações alheias. A
        // colisão só aparece como violação de unicidade — então o caminho certo
        // é tentar e tratar, não checar antes.
        if (!isUniqueViolation(error, "slug")) throw error;
      }
    }

    throw new InternalServerErrorException(
      "Não foi possível gerar um identificador único para a empresa.",
    );
  }

  private async newId(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT uuid_generate_v7() AS id
    `;
    return rows[0]!.id;
  }

  /**
   * Roles de sistema têm organization_id NULL e a política as libera para todos
   * os tenants na leitura (`organization_id IS NULL OR ...`), então a busca
   * precisa acontecer dentro de um escopo de tenant qualquer — usamos o da
   * empresa que está nascendo.
   */
  private async systemRoleId(organizationId: string, key: string): Promise<string> {
    const role = await forTenant(this.prisma, organizationId, (tx) =>
      tx.role.findFirst({ where: { key, organizationId: null } }),
    );

    if (!role) {
      throw new InternalServerErrorException(
        `Role de sistema "${key}" não encontrada. Rode o seed do catálogo.`,
      );
    }

    return role.id;
  }
}

/**
 * Primeiro o slug limpo; depois variações com sufixo aleatório curto.
 * Sequencial (`-2`, `-3`) exigiria contar quantas existem, e contar é justamente
 * o que o RLS impede.
 */
function* slugCandidates(source: string): Generator<string> {
  const base = slugify(source) || "empresa";
  yield base;

  for (let i = 0; i < 5; i++) {
    yield `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : true;
}
