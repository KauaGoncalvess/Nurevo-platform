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

## Estado atual — M0, M1 e M2 entregues

| Marco | Situação |
|---|---|
| **M0 — Fundação** | Monorepo, CI, Postgres com RLS forçado, fronteiras com enforcement |
| **M1 — Conta** | Cadastro, login, refresh com detecção de reuso, sessões, onboarding, convites, RBAC |
| **M2 — Dinheiro** | Planos, entitlements materializados, trial, limites que bloqueiam, webhook idempotente |
| **M3 — Produto** | **não começou** — CRM, serviços, agenda, agendamento, arquivos |
| **M4 — Retenção** | não começou — WhatsApp, no-show, notificações, audit |
| `apps/web` | não começou. A API é o produto até o M3 fechar |

48 testes automatizados: 13 de isolamento entre tenants e 35 de ponta a ponta.

O que existe mas **não foi exercitado contra o serviço real**, por exigir
credencial: o HTTP do Asaas (`infra/asaas.gateway.ts`) e o login com Google
(`infra/google-provider.ts`). Nos dois casos a parte que concentra risco está
testada — verificação do webhook e vinculação de conta por e-mail — e o que
sobra é borda fina atrás de uma interface.

## Requisitos

- Node 22+
- pnpm 10+
- PostgreSQL 16 (via `docker compose up -d` ou instalação local)

## Subindo do zero

```bash
pnpm install
docker compose up -d
cp .env.example .env

# O compose sobe o Postgres com o superuser `postgres`. Os roles da aplicação
# são criados a partir dele.
export SUPERUSER_URL="postgresql://postgres:postgres@localhost:5432/postgres"

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
pnpm --filter @nurevo/backend dev
```

Fluxo completo, do cadastro ao trial:

```bash
curl localhost:3333/health
curl localhost:3333/billing/plans          # tabela de preços é pública

curl -XPOST localhost:3333/auth/signup -H 'content-type: application/json' \
  -d '{"email":"eu@exemplo.com","password":"uma-senha-bem-comprida","name":"Eu"}'

# Em desenvolvimento o link de verificação sai no log do servidor.
curl -XPOST localhost:3333/auth/verify-email -H 'content-type: application/json' \
  -d '{"token":"<token-do-log>"}'

curl -XPOST localhost:3333/auth/login -H 'content-type: application/json' \
  -d '{"email":"eu@exemplo.com","password":"uma-senha-bem-comprida"}'

# Criar a empresa devolve um token novo, já com ela ativa.
curl -XPOST localhost:3333/organizations -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"legalName":"Meu Estúdio LTDA"}'

curl -XPOST localhost:3333/billing/subscribe -H "authorization: Bearer $ORG_TOKEN" \
  -H 'content-type: application/json' -d '{"planKey":"starter"}'
```

> O tenant vem **sempre** das claims do token — nunca de header ou body (doc 01,
> regra 6). O `ALLOW_DEV_TENANT_HEADER` que existiu no M0 era muleta declarada
> até o Auth ficar pronto, e foi removido junto com a chegada dele.

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
