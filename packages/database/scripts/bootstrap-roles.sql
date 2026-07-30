-- ============================================================================
-- Bootstrap de roles — roda UMA VEZ por ambiente, como superuser.
--
-- Roles são infraestrutura, não schema: por isso não vivem em migrations.
-- Migrations rodam como nurevo_owner e não podem criar os próprios roles.
--
--   psql -v app_password=... -v owner_password=... -v admin_password=... \
--        -f scripts/bootstrap-roles.sql
--
-- Os três roles existem porque cada um tem um poder diferente, e a diferença é
-- justamente o que protege o isolamento entre tenants:
--
--   nurevo_owner  dono das tabelas. Só migrations. SEM bypassrls — com FORCE RLS
--                 nas tabelas, nem o dono escapa das políticas. É proposital:
--                 garante que um seed mal escrito não grave lixo cross-tenant.
--   nurevo_app    runtime. Só DML. SEM bypassrls. É o role que sustenta o doc 01.
--   nurevo_admin  COM bypassrls. Existe para billing jobs e painel interno, que
--                 legitimamente cruzam tenants. Restrito por lint (doc 02) a
--                 modules/admin e modules/billing/jobs. Todo uso fora dali é bug.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nurevo_owner') THEN
    CREATE ROLE nurevo_owner LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nurevo_app') THEN
    CREATE ROLE nurevo_app LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nurevo_admin') THEN
    CREATE ROLE nurevo_admin LOGIN NOSUPERUSER BYPASSRLS NOINHERIT;
  END IF;
END
$$;

ALTER ROLE nurevo_owner PASSWORD :'owner_password';
ALTER ROLE nurevo_app   PASSWORD :'app_password';
ALTER ROLE nurevo_admin PASSWORD :'admin_password';

-- Cinto de segurança: se alguém um dia "consertar" um erro de permissão dando
-- BYPASSRLS ao role da aplicação, o teste 1 de isolamento quebra o CI.
ALTER ROLE nurevo_app   NOBYPASSRLS NOSUPERUSER;
ALTER ROLE nurevo_owner NOBYPASSRLS NOSUPERUSER;
