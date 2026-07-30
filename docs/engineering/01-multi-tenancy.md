# 01 — Multi-Tenancy

> Esta é a decisão mais importante da plataforma. Tudo o que vier depois assume o
> que está escrito aqui. Nenhuma linha de código de domínio deve ser escrita antes
> deste documento estar implementado e testado.

## Decisão

**Schema compartilhado, banco único, `organization_id` em toda tabela de negócio,
isolamento forçado por Row Level Security (RLS) do PostgreSQL.**

## Por que não as outras opções

| Modelo | Isolamento | Custo | Migrations | Veredito |
|---|---|---|---|---|
| Banco por tenant | Máximo | Alto (conexões, backup, infra) | N bancos por deploy | Só faz sentido em enterprise com exigência contratual |
| Schema por tenant | Alto | Médio | N schemas por deploy, degrada após ~500 tenants | Migrations viram operação de risco |
| **Schema compartilhado + RLS** | **Alto (garantido pelo banco)** | **Baixo** | **Uma migration** | **Escolhido** |

Para PMEs de serviço — milhares de tenants pequenos — schema compartilhado é o
único modelo com custo por tenant viável. RLS resolve o furo clássico desse modelo
(o `WHERE` esquecido) movendo a garantia da aplicação para o banco.

## Vocabulário

- **Tenant** = `organizations`. É a empresa cliente. Unidade de isolamento e de cobrança.
- **Branch** (`branches`) = filial. Vive **dentro** de um tenant. Não é unidade de isolamento.
- **User** = identidade global. Uma pessoa tem **uma** conta e pode pertencer a
  vários tenants via `memberships`. Não duplicamos usuário por empresa.

Consequência: `users` e as tabelas de catálogo global (`plans`, `modules`,
`features`) **não** têm `organization_id` e **não** têm RLS. Todo o resto tem.

## Regras invioláveis

1. Toda tabela de negócio tem `organization_id uuid NOT NULL`.
2. Toda tabela de negócio tem RLS habilitado **e** `FORCE ROW LEVEL SECURITY`.
3. Toda foreign key entre tabelas de negócio é composta, incluindo `organization_id`.
   Isso impede que um registro do tenant A referencie um registro do tenant B mesmo
   se a aplicação tentar.
4. A aplicação conecta com um role **sem** `BYPASSRLS` e **sem** `SUPERUSER`.
5. Todo índice de tabela de negócio começa por `organization_id`.
6. Nenhum código de domínio lê `organization_id` do body da requisição. Ele vem
   sempre do token/sessão, resolvido no middleware de tenant.

## Implementação — banco

Role da aplicação (migration inicial, executada uma vez):

```sql
CREATE ROLE nurevo_app LOGIN PASSWORD :'app_password' NOINHERIT;
-- explicitamente sem BYPASSRLS, sem SUPERUSER
GRANT USAGE ON SCHEMA public TO nurevo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nurevo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nurevo_app;
```

Padrão aplicado a **toda** tabela de negócio:

```sql
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON appointments
  USING      (organization_id = current_setting('app.organization_id', TRUE)::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id', TRUE)::uuid);
```

`USING` protege leitura/update/delete. `WITH CHECK` protege insert/update — sem ele,
um tenant consegue **gravar** linha com o `organization_id` de outro.

O terceiro argumento `TRUE` em `current_setting` faz a função retornar `NULL` em vez
de erro quando a variável não foi setada. Como `x = NULL` é `NULL` (nunca `TRUE`),
**esquecer de setar o tenant resulta em zero linhas, nunca em vazamento**. Esse é o
comportamento desejado: falha fechada.

Migrations do Prisma não geram RLS. Cada migration que cria tabela de negócio
recebe o bloco acima escrito à mão, e o teste do item "Testes obrigatórios" abaixo
falha se alguém esquecer.

## Implementação — Prisma

O `organization_id` é injetado por transação, via `set_config(..., TRUE)` — o `TRUE`
final significa *local à transação*, então a variável morre no commit/rollback e
**não vaza para a próxima requisição que pegar a mesma conexão do pool**. Setar fora
de transação (`SET` simples) é bug de segurança com connection pool.

```ts
// packages/database/src/tenant-client.ts
export function forTenant<T>(
  prisma: PrismaClient,
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, TRUE)`;
    return fn(tx);
  });
}
```

No NestJS isso vive em um `AsyncLocalStorage` populado pelo `TenantMiddleware`, de
forma que repositórios recebem o client já escopado e código de domínio nunca chama
`forTenant` na mão.

Operações administrativas legítimas que cruzam tenants (job de billing, painel
interno, relatório de plataforma) usam um client **separado**, com role próprio e
`BYPASSRLS`, exposto apenas em `packages/database/src/admin-client.ts` e proibido
por lint fora de `modules/admin` e `modules/billing/jobs`.

## PgBouncer

Se entrar PgBouncer, obrigatoriamente em **transaction pooling**. `SET LOCAL` dentro
de transação é seguro nesse modo. Em *session pooling* o modelo continua correto mas
perde o benefício do pool; em *statement pooling* quebra — não usar.

## O que RLS não resolve

- **Autorização dentro do tenant.** RLS diz "esse dado é da empresa X". Quem pode
  ver o quê dentro da empresa X é RBAC, documento `02`.
- **Vazamento por cache.** Toda chave de Redis é prefixada `org:{organizationId}:`.
  Sem exceção.
- **Vazamento por arquivo.** Todo objeto no S3 é `org/{organizationId}/...` e servido
  por URL assinada de curta duração, nunca por bucket público.
- **Vazamento por fila.** Todo job do BullMQ carrega `organizationId` no payload e o
  processor abre a transação com `forTenant` antes de qualquer query.

## Testes obrigatórios

Estes testes rodam no CI e bloqueiam merge:

1. **Cobertura de RLS** — query no `pg_catalog` que lista toda tabela com coluna
   `organization_id` sem `relrowsecurity` **e** sem `relforcerowsecurity`. Resultado
   esperado: vazio. Pega migration que esqueceu o bloco de política.
2. **Isolamento de leitura** — cria tenants A e B com dados; abre transação como A;
   `findMany` sem `where`; espera não ver nada de B.
3. **Isolamento de escrita** — como tenant A, tenta inserir linha com
   `organization_id` de B; espera erro de política, não sucesso.
4. **Falha fechada** — executa query sem `set_config`; espera zero linhas.
5. **Não vazamento entre requisições** — duas transações sequenciais na mesma
   conexão com tenants diferentes; a segunda não enxerga a primeira.
