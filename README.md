# Nurevo Platform

Plataforma SaaS multi-tenant para negócios de serviço. Monolito modular:
um deployable, um banco, módulos com fronteira verificada por CI.

**Regra Nº 1 — nenhum SaaS novo começa do zero. Todo produto futuro é um módulo.**

A regra vale por extração, não por profecia: o Core nasce do que provou repetir
no primeiro produto vertical, não do que a gente imagina que vai repetir.

## Documentação de engenharia

Leia nesta ordem. Nenhuma linha de código de domínio deve contrariá-los.

| Doc | Assunto |
|---|---|
| [01 — Multi-Tenancy](docs/engineering/01-multi-tenancy.md) | Isolamento por RLS. A decisão que tudo depende |
| [02 — Módulos e Fronteiras](docs/engineering/02-modules-boundaries.md) | Anatomia de módulo e enforcement no CI |
| [03 — Modelo de Dados V1](docs/engineering/03-data-model-v1.md) | 32 tabelas, não 150 |
| [04 — Roadmap V1](docs/engineering/04-roadmap-v1.md) | Escopo fechado e critérios de sucesso |

## Estado atual — M0 (Fundação)

| Item | Situação |
|---|---|
| Monorepo, CI, tooling | pronto |
| Postgres + RLS forçado + migration inicial | pronto |
| Identity + Organizations + RBAC (11 tabelas) | schema pronto, sem API ainda |
| 5 testes de isolamento entre tenants | verdes, verificados por mutação |
| Fronteiras de módulo no lint e no schema | ativas, verificadas por mutação |
| Backend Nest com TenantMiddleware | health + rota de exemplo |
| Auth, billing, CRM, agenda | **não começou** — M1 em diante |

## Requisitos

- Node 22+
- pnpm 10+
- PostgreSQL 16 (via `docker compose up -d` ou instalação local)

## Subindo do zero

```bash
pnpm install
docker compose up -d
cp .env.example .env

# Roles são infraestrutura, não schema: rodam uma vez, como superuser.
# São TRÊS roles com poderes diferentes, e a diferença é o que protege o
# isolamento entre empresas. Ver docs/engineering/01-multi-tenancy.md.
psql "$SUPERUSER_URL" \
  -v app_password=app_password \
  -v owner_password=owner_password \
  -v admin_password=admin_password \
  -f packages/database/scripts/bootstrap-roles.sql
psql "$SUPERUSER_URL" -c 'CREATE DATABASE nurevo OWNER nurevo_owner;'

pnpm db:migrate
pnpm --filter @nurevo/database seed     # catálogo de permissões e roles de sistema
pnpm build
```

Subir o backend em desenvolvimento:

```bash
ALLOW_DEV_TENANT_HEADER=true pnpm --filter @nurevo/backend dev
```

```bash
curl localhost:3333/health
# {"status":"ok","database":"ok"}

curl localhost:3333/branches
# 401 — rota de domínio sem empresa no contexto

SEED_DEMO=true pnpm --filter @nurevo/database seed   # imprime o id do tenant demo
curl -H "x-organization-id: <id>" localhost:3333/branches
```

> `ALLOW_DEV_TENANT_HEADER` existe só enquanto o Auth não está pronto (M1). Em
> produção o tenant vem **sempre** das claims do token. Se a variável estiver
> ligada com `NODE_ENV=production`, o processo se recusa a subir — trocar de
> empresa por header seria trocar de empresa à vontade.

## Comandos

```bash
pnpm build                                    # turbo: database -> backend
pnpm lint                                     # inclui as fronteiras do doc 02
pnpm typecheck
pnpm --filter @nurevo/database test           # os 5 testes de isolamento
pnpm --filter @nurevo/database check:boundaries  # relação cross-module no schema
pnpm db:migrate
pnpm db:reset
```

## O que o CI bloqueia

Não é cerimônia — cada item existe porque falha silenciosa nessa área custa caro:

1. **Isolamento entre tenants** (doc 01). Inclui uma varredura do `pg_catalog`
   que reprova qualquer tabela com `organization_id` sem RLS habilitado e
   forçado. É o que pega a migration que esqueceu a política.
2. **Fronteiras de código** (doc 02). Import do interno de outro módulo, `core`
   importando de `modules`, ou o client `BYPASSRLS` fora de admin/billing-jobs.
3. **Fronteira de dados** (doc 02). `@relation` atravessando módulo no schema
   Prisma. O Prisma gera um client só — sem esta checagem, um `include` amarra
   dois domínios em silêncio.
4. Lint, typecheck e build.

Os três primeiros foram verificados por mutação: cada proteção foi quebrada de
propósito e o CI ficou vermelho em todas. Teste que nunca falhou não é proteção,
é decoração.

## Arquitetura em uma tela

```
apps/backend/src/
  core/          infra transversal — tenant, database, health. NÃO importa de modules/
  modules/       domínio. Cada um com index.ts como ÚNICO contrato público
packages/
  database/      Prisma, RLS, forTenant(), testes de isolamento
  eslint-config/ as regras de fronteira do doc 02
  tsconfig/
```

Como um dado de uma empresa não vaza para outra:

```
requisição -> TenantMiddleware -> AsyncLocalStorage
           -> withTenant() -> transação com set_config('app.organization_id', ..., TRUE)
           -> política de RLS no Postgres, com role sem BYPASSRLS
```

Esquecer qualquer elo devolve **zero linhas**, nunca as linhas de outra empresa.
