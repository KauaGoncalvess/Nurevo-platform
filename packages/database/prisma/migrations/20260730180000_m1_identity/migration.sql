-- ============================================================================
-- M1 — Conta
-- ============================================================================

-- ----------------------------------------------------------------------------
-- current_user_id()
--
-- Segunda GUC, irmã de current_organization_id().
--
-- Existe para resolver um problema que o RLS por tenant cria: antes de escolher
-- a empresa ativa, o usuário não tem tenant no contexto — então "minhas empresas"
-- retornaria zero linhas, e o login ficaria sem para onde ir.
--
-- A alternativa seria usar o client BYPASSRLS nesse caminho. Seria abrir o bypass
-- de isolamento na rota mais quente do produto, para sempre. Uma política a mais
-- é muito mais barata que isso.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.user_id', TRUE), '')::uuid;
$$;

-- ----------------------------------------------------------------------------
-- Política adicional em memberships.
--
-- Políticas PERMISSIVAS se somam com OR. Logo, esta NÃO enfraquece o isolamento
-- por tenant: quem não setou app.user_id continua vendo só o tenant corrente, e
-- quem setou vê apenas as PRÓPRIAS memberships — nunca as de outra pessoa.
--
-- Sem WITH CHECK de propósito: este caminho é somente leitura. Criar membership
-- continua exigindo o tenant, pela política tenant_isolation.
-- ----------------------------------------------------------------------------
CREATE POLICY own_memberships ON "memberships"
  FOR SELECT
  USING ("user_id" = current_user_id());

-- ----------------------------------------------------------------------------
-- Unicidade real das roles de sistema.
--
-- `@@unique([organizationId, key])` vira um índice UNIQUE comum, e no Postgres
-- NULLs são distintos entre si por padrão: (NULL,'owner') não colide com
-- (NULL,'owner'). Ou seja, o unique do M0 NÃO impedia roles de sistema
-- duplicadas — bastava rodar o seed duas vezes em paralelo.
--
-- Índice parcial resolve sem depender de NULLS NOT DISTINCT (PG15+) nem de
-- suporte do Prisma a essa cláusula.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "roles_system_key_key"
  ON "roles" ("key")
  WHERE "organization_id" IS NULL;

-- Busca de convite pendente por e-mail, e expiração em lote.
CREATE INDEX "invitations_expires_at_idx"
  ON "invitations" ("expires_at")
  WHERE "accepted_at" IS NULL;

-- ----------------------------------------------------------------------------
-- "Minhas empresas": ler organizations sem ter tenant escolhido.
--
-- Mesmo problema de memberships, um nível acima — a tela pós-login precisa dos
-- NOMES das empresas, e organizations é isolada por id.
--
-- A subconsulta roda com as permissões de quem chamou, então o RLS de
-- memberships vale dentro dela; o filtro por current_user_id() casa exatamente
-- com a política own_memberships. Não há recursão: memberships não referencia
-- organizations em nenhuma política.
--
-- Só membership ATIVA. Convite pendente não revela o nome da empresa.
-- ----------------------------------------------------------------------------
CREATE POLICY member_organizations ON "organizations"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."organization_id" = "organizations"."id"
      AND m."user_id" = current_user_id()
      AND m."status" = 'active'
  ));

-- ----------------------------------------------------------------------------
-- Aceitar convite: ler UMA linha de invitations sem ser membro ainda.
--
-- Quem foi convidado não tem membership, logo não tem tenant — e o convite vive
-- numa tabela isolada por tenant. Sem uma saída, aceitar convite exigiria o
-- client BYPASSRLS, abrindo o bypass num fluxo exposto ao público.
--
-- Terceira GUC, mesmo padrão das outras duas: a política só libera a linha cujo
-- hash de token foi apresentado. Não é "confie no usuário" — é "prove que tem o
-- token", e o token só chegou por e-mail. Comparar o HASH significa que nem o
-- valor em claro trafega para o banco.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_invitation_token()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.invitation_token_hash', TRUE), '');
$$;

CREATE POLICY invitation_by_token ON "invitations"
  FOR SELECT
  USING ("token_hash" = current_invitation_token());
