# 03 — Modelo de Dados V1

> 32 tabelas. Não 150. As outras nascem junto com o módulo que precisa delas.
> Este documento deve ser traduzível direto para `schema.prisma` sem nenhuma decisão
> pendente. Se algo aqui exige debate, o debate acontece antes da primeira migration.

## Convenções

- PK `uuid` (v7, ordenável por tempo — evita fragmentação de índice do v4).
- `created_at`, `updated_at` em toda tabela. `deleted_at` só onde soft delete é regra
  de negócio (marcado com †).
- Toda tabela de negócio: `organization_id uuid NOT NULL` + RLS (doc `01`).
- Tabelas **globais** (sem `organization_id`, sem RLS) marcadas com **G**.
- Dinheiro: `numeric(12,2)` + `currency char(3)`. Nunca `float`.
- Datas com hora: `timestamptz`, sempre UTC. `timezone` do tenant fica em `organizations`.
- Índice sempre começando por `organization_id`.

---

## Identity — `modules/identity`

**1. `users` G**
`id`, `email` (unique, citext), `email_verified_at`, `password_hash` (nullable — login social), `name`, `avatar_url`, `locale` (default `pt-BR`), `theme`, `last_login_at`, `status` (`active|blocked`)

Identidade global. Uma pessoa, uma conta, N empresas.

**2. `user_identities` G**
`id`, `user_id`, `provider` (`google|apple|microsoft|github`), `provider_user_id`, `email`
Unique `(provider, provider_user_id)`.

V1 implementa **apenas Google**. A tabela já suporta o resto sem migration.

**3. `refresh_tokens` G**
`id`, `user_id`, `token_hash` (nunca o token), `family_id`, `expires_at`, `revoked_at`, `ip`, `user_agent`, `device_label`

`family_id` implementa rotação com detecção de reuso: reuso de token revogado
invalida a família inteira. Session Manager do documento de visão = listar e revogar
por `family_id`.

**4. `email_verification_tokens` G** — `id`, `user_id`, `token_hash`, `purpose` (`verify|reset|magic_link`), `expires_at`, `consumed_at`

---

## Organizations — `modules/organizations`

**5. `organizations`** (o tenant; a própria tabela é a raiz — `id` é o `organization_id`)
`id`, `slug` (unique), `legal_name`, `trade_name`, `document` (CNPJ/CPF), `timezone` (default `America/Sao_Paulo`), `locale`, `logo_url`, `status` (`trialing|active|past_due|suspended|canceled`), `onboarded_at` †

**6. `branches`** — `id`, `organization_id`, `name`, `address_json`, `phone`, `timezone`, `is_default` †

Filial. V1 cria uma default automaticamente; a UI de múltiplas filiais é V2, mas a
coluna existe desde já em `appointments` — adicionar depois é migration de dados cara.

**7. `memberships`** — `id`, `organization_id`, `user_id`, `role_id`, `status` (`invited|active|suspended`), `invited_by`, `joined_at`
Unique `(organization_id, user_id)`.

**8. `roles`** — `id`, `organization_id` (nullable = role de sistema), `key` (`owner|admin|staff|viewer`), `name`, `is_system`

Roles de sistema têm `organization_id NULL` e são visíveis a todos (política de RLS
com `OR organization_id IS NULL`). Tenant pode criar roles próprias em V2.

**9. `permissions` G** — `id`, `key` (`appointments:write`, `billing:read`, ...), `module_key`, `description`

Catálogo estático, populado por seed. Convenção `recurso:ação`.

**10. `role_permissions`** — `role_id`, `permission_id` (PK composta)

**11. `invitations`** — `id`, `organization_id`, `email`, `role_id`, `token_hash`, `expires_at`, `accepted_at`, `invited_by`

RBAC V1 é **flat**: membership → role → permissions. Sem ACL por registro, sem
hierarquia de roles, sem policies dinâmicas. Isso cobre 95% de PME. ABAC entra
quando um cliente pagante exigir.

---

## Billing & Entitlements — `modules/billing`

O pilar que faltava no documento de visão. É o que transforma "módulo" em "produto vendável".

**12. `plans` G** — `id`, `key` (`starter|pro|business`), `name`, `description`, `trial_days`, `is_public`, `sort_order`

**13. `plan_prices` G** — `id`, `plan_id`, `interval` (`month|year`), `amount`, `currency`, `active`

**14. `modules` G** — `id`, `key` (`crm|tattoo|gym|clinic`), `name`, `description`, `is_core`

Catálogo de módulos vendáveis. Espelha as pastas de `modules/` do doc `02`.

**15. `features` G** — `id`, `key` (`appointments.max_per_month`, `files.storage_gb`, `whatsapp.enabled`), `type` (`boolean|limit`), `unit`

**16. `plan_modules` G** — `plan_id`, `module_id` (PK composta)

**17. `plan_features` G** — `plan_id`, `feature_id`, `value` (`jsonb`: `true` ou `{"limit": 500}`)

**18. `subscriptions`** — `id`, `organization_id`, `plan_id`, `plan_price_id`, `status` (`trialing|active|past_due|canceled`), `trial_ends_at`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `gateway`, `gateway_subscription_id`

**19. `organization_entitlements`** — `id`, `organization_id`, `feature_key`, `value` (`jsonb`), `source` (`plan|override|addon`), `expires_at`

Materialização do que o tenant pode usar **agora**. Recalculada em mudança de plano
e cacheada em Redis (`org:{id}:entitlements`, TTL 5min, invalidada em write).
Toda checagem de permissão de uso lê daqui — nunca do plano direto, senão overrides
comerciais e cortesias viram gambiarra.

**20. `usage_counters`** — `id`, `organization_id`, `feature_key`, `period` (`2026-07`), `used`, `limit_snapshot`
Unique `(organization_id, feature_key, period)`. Incremento atômico.

**21. `invoices`** — `id`, `organization_id`, `subscription_id`, `number`, `status` (`draft|open|paid|void|uncollectible`), `subtotal`, `discount`, `total`, `currency`, `due_at`, `paid_at`, `gateway_invoice_id`

**22. `payments`** — `id`, `organization_id`, `invoice_id`, `method` (`pix|card|boleto`), `status` (`pending|confirmed|failed|refunded`), `amount`, `gateway`, `gateway_payment_id`, `paid_at`, `payload_json`

**23. `coupons` G** — `id`, `code` (unique), `type` (`percent|fixed`), `value`, `duration` (`once|repeating|forever`), `max_redemptions`, `redeemed_count`, `expires_at`

**24. `webhook_events`** — `id`, `organization_id` (nullable), `provider` (`asaas`), `event_id` (unique por provider), `type`, `payload_json`, `processed_at`, `error`

Unique em `(provider, event_id)` é o que garante idempotência. Gateway reenvia; sem
essa constraint você cobra duas vezes.

**Gateway V1: Asaas apenas.** Cobre Pix, boleto e cartão no Brasil com uma
integração. Interface `PaymentGateway` em `modules/billing/domain` para que Stripe
(internacional) e Mercado Pago entrem depois sem tocar em regra de negócio.

---

## Files — `modules/files`

**25. `files`** — `id`, `organization_id`, `owner_type`, `owner_id`, `bucket`, `key`, `original_name`, `mime_type`, `size_bytes`, `checksum`, `variants_json` (thumbs), `uploaded_by`, `status` (`pending|ready|failed`) †

Upload direto do browser para o S3 por URL pré-assinada — o backend nunca recebe o
byte. Chave sempre `org/{organization_id}/{module}/{uuid}`. Registro criado como
`pending`, promovido a `ready` pelo webhook/confirmação. Job diário limpa `pending`
com mais de 24h.

---

## Notifications — `modules/notifications`

**26. `notification_templates`** — `id`, `organization_id` (nullable = template de sistema), `key`, `channel` (`email|whatsapp|sms|push`), `locale`, `subject`, `body`, `variables_json`

**27. `notifications`** — `id`, `organization_id`, `recipient_type` (`user|customer`), `recipient_id`, `channel`, `template_key`, `payload_json`, `status` (`queued|sent|delivered|failed|read`), `provider_message_id`, `scheduled_for`, `sent_at`, `error`

Outbox. Nada é enviado direto de dentro de um use case: grava a linha, o worker do
BullMQ envia. Isso dá retry, auditoria e evita e-mail enviado em transação revertida.

**28. `notification_preferences`** — `id`, `organization_id`, `user_id`, `channel`, `category`, `enabled`

**WhatsApp: API oficial (Cloud API da Meta) desde o V1.** Biblioteca não-oficial
custa o número do cliente em ban e mata a confiança no produto. Se o custo por
conversa inviabilizar, o canal sai do V1 — não vira gambiarra.

---

## Audit — `core/audit`

**29. `audit_logs`** — `id`, `organization_id`, `actor_user_id`, `actor_type` (`user|system|api_key`), `action` (`appointment.canceled`), `resource_type`, `resource_id`, `changes_json` (before/after dos campos alterados), `ip`, `user_agent`, `created_at`

Append-only: `GRANT` sem `UPDATE`/`DELETE` para o role da aplicação. Particionada por
mês desde o início — repartir depois de 50M de linhas é downtime.

---

## CRM — `modules/crm`

Cliente final é do **core**, não do vertical. É o que permite que Tattoo, Gym e
Barber compartilhem a mesma base de clientes de uma empresa que opera dois negócios.

**30. `customers`** — `id`, `organization_id`, `name`, `email`, `phone`, `document`, `birth_date`, `notes`, `tags` (`text[]`), `source`, `consent_json` (LGPD: aceite de marketing, data, origem), `last_visit_at` †

Índice de busca: `GIN` em `to_tsvector(name || email || phone)`, escopado por
`organization_id`.

---

## Tattoo — `modules/tattoo`

Mínimo para o produto ser vendável. Portfólio, orçamento e comissão são V1.1.

**31. `services`** — `id`, `organization_id`, `name`, `description`, `duration_minutes`, `price`, `currency`, `deposit_amount`, `active` †

**32. `appointments`** — `id`, `organization_id`, `branch_id`, `customer_id`, `service_id`, `professional_id` (→ `memberships.user_id`), `starts_at`, `ends_at`, `status` (`scheduled|confirmed|in_progress|completed|no_show|canceled`), `price`, `deposit_paid`, `notes`, `canceled_reason`, `canceled_by` †

Constraint de conflito de agenda no banco, não na aplicação:

```sql
ALTER TABLE appointments ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('canceled', 'no_show'));
```

Duas requisições simultâneas agendando o mesmo horário é o bug clássico de todo
sistema de agendamento. Checar em código não resolve — `EXCLUDE` resolve.

---

## Fora do V1 (deliberadamente)

`ai_*`, `analytics_*`, `marketplace_*`, `api_keys`, `integrations`, `departments`,
`teams`, `policies`/ACL por registro, `products`/estoque, `commissions`.

Cada uma entra com o módulo que a justifica. Modelar agora é adivinhar.

## Ordem de implementação

1. `organizations` → 2. `users`/`memberships`/`roles` → 3. RLS + testes do doc `01`
→ 4. `plans`/`modules`/`features`/`entitlements` → 5. `subscriptions`/`invoices`/`payments`
→ 6. `customers` → 7. `services`/`appointments` → 8. `files` → 9. `notifications` → 10. `audit_logs`

Os passos 1–3 não têm valor visível para o cliente e são inegociáveis. Tudo depois
deles é feature.
