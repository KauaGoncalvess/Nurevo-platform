# 04 — Roadmap V1

> O roadmap original (V1..V10) é uma lista de desejos: sem data, sem responsável,
> sem meta de receita, sem critério de "deu certo". Este documento fecha o escopo do
> V1 e define o que prova que ele funcionou.

## Tese

A Regra Nº 1 — "todo SaaS futuro é um módulo" — continua valendo. O que muda é a
ordem: **plataformas boas são extraídas de produtos, não projetadas antes deles.**

O V1 constrói o produto Tattoo end-to-end, **dentro da forma de pastas da
plataforma**, com tenancy, RBAC, billing e entitlements feitos direito. O Core é
extraído do que provou repetir — não do que a gente imagina que vai repetir.

Consequência prática: nenhuma abstração é criada com um único caso de uso. A
segunda vertical é que revela a fronteira certa. Criar `PetModule` antes de ter um
cliente de pet shop é escrever código para um requisito imaginário.

## Escopo fechado do V1

**Dentro:**

| Área | Escopo |
|---|---|
| Auth | E-mail/senha + Google. Verificação de e-mail, reset, refresh com rotação, gestão de sessões |
| Organizations | Tenant, 1 filial default, convites, RBAC flat (`owner/admin/staff/viewer`) |
| Billing | Asaas (Pix, boleto, cartão), 3 planos, trial 14 dias, cupom, entitlements + limites |
| Files | Upload direto S3 por URL assinada, imagem + PDF, thumbnail |
| Notifications | E-mail (transacional) + WhatsApp Cloud API (lembrete de agendamento) |
| CRM | Cadastro de cliente, busca, histórico, consentimento LGPD |
| Tattoo | Serviços, agenda, agendamento, status, sinal/depósito, lembrete automático |
| Admin | Somente o que a operação exige: listar tenants, ver assinatura, suspender |

**Fora — explicitamente adiado:**

Apple/Microsoft/GitHub login · magic link · 2FA · Stripe · Mercado Pago · OpenPix ·
IA (qualquer uma) · Analytics · Marketplace · app mobile · API pública · múltiplas
filiais na UI · departamentos e equipes · ACL por registro · Gym/Clinic/Pet/Barber/AutoCenter

Cada item acima tem gatilho de entrada, não data. 2FA entra quando um cliente pedir
por escrito. Stripe entra no primeiro cliente fora do Brasil. IA entra quando houver
uma tarefa concreta que o cliente já paga alguém para fazer.

## Marcos

| Marco | Entrega | Pronto quando |
|---|---|---|
| **M0 — Fundação** | Monorepo, CI, Postgres+RLS, migrations, deploy em staging | Os 5 testes de isolamento do doc `01` passam no CI e bloqueiam merge |
| **M1 — Conta** | Auth, organizations, memberships, RBAC, onboarding | Um usuário se cadastra e cria empresa sem intervenção manual |
| **M2 — Dinheiro** | Planos, entitlements, assinatura, Asaas, webhooks | Um trial converte em assinatura paga e o limite de plano bloqueia de verdade |
| **M3 — Produto** | CRM, serviços, agenda, agendamento, arquivos | Um estúdio real opera um dia inteiro só na Nurevo |
| **M4 — Retenção** | Lembrete WhatsApp, no-show, notificações, audit | Taxa de no-show do piloto cai vs. o mês anterior |
| **M5 — Beta pago** | Landing, checkout self-service, docs de ajuda, Sentry | Cliente entra, paga e usa sem ninguém do time no meio |

Datas não estão fixadas aqui de propósito — dependem do tamanho do time, que ainda
não foi definido. A ordem, sim, é fixa: **M0 antes de tudo, M2 antes de M3.**
Construir produto antes de saber cobrar é o erro que faz o time descobrir no mês 5
que o billing não modela o que o produto virou.

## Critérios de sucesso do V1

O V1 acabou quando, e só quando:

1. **10 estúdios pagantes**, entrados por self-service, sem migração manual do time.
2. **Churn < 10%/mês** nos primeiros 3 meses de cada cliente.
3. **Custo de infra por tenant < 3% do MRR do tenant.** Se estourar, o modelo de
   schema compartilhado não está sendo aproveitado ou o plano está barato demais.
4. **Zero incidente de vazamento entre tenants.** Não negociável.
5. **Onboarding < 20 minutos** do cadastro ao primeiro agendamento criado.

Falhar em 1 ou 2 significa que o problema não é técnico e nenhum módulo novo
conserta. Falhar em 3 significa revisar pricing antes de escalar.

## Gatilho para o V2

A segunda vertical só começa quando o V1 bater os critérios acima **e** o Core tiver
sido extraído — isto é, quando `modules/tattoo` não contiver nada que qualquer outro
nicho também precisaria.

Nicho seguinte escolhido por dado, não por preferência: qual dos nichos tem maior
sobreposição com o que já existe (agenda + cliente + cobrança) e menor custo de
aquisição. Barbearia e salão são os candidatos naturais — o modelo de agenda é quase
o mesmo. Clínica traz exigência regulatória (dado de saúde, LGPD sensível) e não
deve ser a segunda.

## Riscos monitorados

| Risco | Mitigação |
|---|---|
| Escopo do Core crescer para "tudo que qualquer SaaS precisa" | Nada entra no `core/` com um único consumidor |
| Coolify self-hosted com dado de cliente | Backup automatizado + **teste de restauração mensal documentado**. Backup não testado não é backup |
| Custo do WhatsApp por conversa | Medir por tenant desde o M4; se inviável, o canal vira add-on pago |
| LGPD | Consentimento e exportação/exclusão de dados no M3, não depois |
| Modelar 150 tabelas antes de vender | Este documento é a mitigação |

## O que fazer a seguir

1. Revisar e aprovar os documentos `01`–`04`.
2. Definir tamanho do time e converter os marcos em datas.
3. Scaffold do monorepo conforme doc `02`.
4. Primeira migration: `organizations`, `users`, `memberships`, `roles` + RLS + os 5
   testes de isolamento no CI.

Nenhuma linha de código de domínio antes do passo 4 estar verde.
