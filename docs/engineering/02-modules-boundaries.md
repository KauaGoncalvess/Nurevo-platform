# 02 — Módulos e Fronteiras

> "Modular monolith" não é uma intenção, é uma restrição verificável. Se a fronteira
> não quebra o CI, ela não existe — em seis meses o monolito modular vira monolito.

## Regra de deploy

Um único deployable: `apps/backend`. Um único banco. Um único processo web + um
processo worker. Módulos são fronteiras de **código**, não de rede.

Extração de um módulo para serviço próprio só acontece com uma restrição medida —
perfil de recurso incompatível (GPU, memória), requisito de escala independente
comprovado por métrica, ou exigência de compliance. Nunca por estética.

## Estrutura de pastas

O documento de visão listava `packages/` e `services/` como irmãos de topo, o que
sugere deployables separados. Correção: **módulos vivem dentro do backend**.

```
apps/
  backend/
    src/
      core/                    # infra transversal, sem regra de negócio
        tenant/                # middleware + AsyncLocalStorage do organization_id
        auth/                  # guards, estratégias, emissão de token
        rbac/                  # avaliação de permissão
        entitlements/          # "esse tenant pode usar isso?"
        outbox/                # publicação de eventos de domínio
      modules/
        identity/
        organizations/
        billing/
        files/
        notifications/
        crm/
        tattoo/
  web/
  admin/                       # V2
packages/
  ui/  types/  config/  eslint-config/  tsconfig/  shared/
  database/                    # Prisma client, tenant-client, admin-client
docs/
  engineering/
```

`services/` deixa de existir como pasta de topo. Storage, e-mail e gateway de
pagamento são **adapters** dentro de `modules/files`, `modules/notifications` e
`modules/billing`, atrás de interfaces.

## Anatomia de um módulo

```
modules/tattoo/
  index.ts              # ÚNICO ponto de importação externa
  tattoo.module.ts
  api/                  # controllers, DTOs (zod), rotas HTTP
  domain/               # entidades, regras, tipos — sem Prisma, sem Nest
  application/          # use cases, orquestração
  infra/                # repositórios Prisma, adapters externos
  events/               # eventos publicados e handlers consumidos
  prisma/schema.prisma  # apenas as tabelas deste módulo
  tests/
```

O `index.ts` exporta **somente** o contrato público: interfaces de serviço, tipos de
evento, DTOs de leitura. Nunca entidade Prisma, nunca repositório, nunca controller.

## As quatro regras de fronteira

1. **Nenhum módulo importa de outro módulo, exceto pelo `index.ts` público.**
   `import { BillingService } from '@/modules/billing'` — permitido.
   `import { InvoiceRepository } from '@/modules/billing/infra/invoice.repository'` — proibido.

2. **Nenhum módulo lê tabela de outro módulo.** Sem `JOIN` entre domínios, sem
   `include` cruzado no Prisma. Precisa do dado? Chama o serviço público. O custo de
   uma chamada em processo é desprezível e é ele que mantém a extração possível.

3. **`core/` não importa de `modules/`.** A dependência é sempre
   `modules → core`, nunca o contrário. Se `core` precisa saber algo de um módulo,
   o desenho está errado.

4. **Comunicação entre módulos é síncrona por interface pública ou assíncrona por
   evento.** Escrita que atravessa domínio usa evento, não chamada direta —
   `appointment.completed` dispara faturamento, o módulo `tattoo` não conhece
   `billing`.

## Enforcement mecânico

`eslint-plugin-boundaries` em `packages/eslint-config`, rodando no CI com
`--max-warnings=0`:

```js
// packages/eslint-config/boundaries.js
settings: {
  'boundaries/elements': [
    { type: 'core',          pattern: 'apps/backend/src/core/*' },
    { type: 'module-public', pattern: 'apps/backend/src/modules/*/index.ts', mode: 'full' },
    { type: 'module-internal', pattern: 'apps/backend/src/modules/*/**' },
  ],
},
rules: {
  'boundaries/element-types': ['error', {
    default: 'disallow',
    rules: [
      { from: 'module-internal', allow: ['core', 'module-public', ['module-internal', { module: '${module}' }]] },
      { from: 'core',            allow: ['core'] },
      { from: 'module-public',   allow: ['module-internal'] },
    ],
  }],
}
```

Complementos no mesmo pipeline:

- `no-restricted-imports` proibindo `@/modules/*/infra/*` e `@/modules/*/domain/*`
  de fora do próprio módulo.
- `admin-client.ts` (o client com `BYPASSRLS` do doc `01`) restrito a
  `modules/admin/**` e `modules/billing/jobs/**`.
- **Teste de fronteira de dados:** script que carrega cada `prisma/schema.prisma` de
  módulo e falha se um modelo declarar relação para modelo de outro módulo. Relação
  cross-module se representa por `uuid` simples, sem `@relation`.

Sem esses três, as regras acima são decoração.

## Prisma com múltiplos módulos

Usar `prismaSchemaFolder` (preview `prismaSchemaFolder`), com um `.prisma` por
módulo e um `base.prisma` com `datasource` e `generator`. O client gerado é único —
essa é uma limitação real do Prisma, e é exatamente por isso que a regra 2 e o teste
de fronteira de dados existem: o banco não impede o join, o CI impede.

## Módulo de negócio = unidade de venda

Todo módulo vertical (`tattoo`, `gym`, `clinic`) tem uma linha correspondente na
tabela `modules` do documento `03` e é ligado/desligado por tenant via entitlements.
Um módulo desligado não expõe rota, não aparece no menu, não processa job.

O guard `@RequiresModule('tattoo')` em `core/entitlements` é obrigatório em todo
controller de módulo vertical. Sem ele, o módulo não é vendável — é só código.

## Checklist para criar um módulo novo

1. Pasta com a anatomia acima.
2. Linha em `modules` (catálogo) + associação aos planos que o incluem.
3. `@RequiresModule` em todos os controllers.
4. Tabelas com `organization_id`, RLS e política — doc `01`.
5. Eventos publicados documentados no `index.ts`.
6. Zero import de `infra`/`domain` alheio — CI confirma.
