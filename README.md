# BETWEEN

Supabase Edge Functions for BETWEEN: the authenticated website chat and the Telegram companion bot.

## Repository layout

- `supabase/config.toml` — Supabase project configuration and per-function JWT settings.
- `supabase/functions/chat-with-psychologist/index.ts` — authenticated chat endpoint used by the website.
- `supabase/functions/telegram-bot/index.ts` — Telegram webhook handler and companion bot.

## Supabase project

Project ref: `cijjzrofrbneatapcpqr`

The repository root contains the `supabase/` directory. When configuring a GitHub integration, use the repository root as the working directory (leave the field empty if the integration treats empty as repository root).

## Required Edge Function secrets

Configure secrets in the Supabase project; never commit their values to this repository.

For `telegram-bot`:
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BETWEEN_SUBSCRIPTION_PRICE_STARS` — optional until pricing is decided; set it to a positive whole-number Telegram Stars amount to enable purchase invoices.

For `chat-with-psychologist`:
- `OPENROUTER_API_KEY`

The chat function uses the authenticated user's Supabase context. The Telegram function uses a server-side service-role key and therefore must not expose that key to a client.

## Deployment

Deploy each function explicitly after reviewing changes:

```sh
supabase login
supabase link --project-ref cijjzrofrbneatapcpqr
supabase functions deploy chat-with-psychologist
supabase functions deploy telegram-bot
```

Do not deploy automatically until the GitHub integration and secrets have been checked. The Telegram webhook must point to:

```
https://cijjzrofrbneatapcpqr.supabase.co/functions/v1/telegram-bot
```

## Function authentication

- `chat-with-psychologist`: JWT verification enabled; requires an authenticated Supabase user.
- `telegram-bot`: JWT verification disabled because Telegram webhook requests do not carry a Supabase JWT. The function must validate/process requests server-side and keep all secrets in Supabase.

## Psychological-support behavior policy

BETWEEN is a non-clinical emotional-support companion. Its response rules and quality checks are documented separately:

- [Evidence-informed psychological-support protocol](docs/psychological-support-protocol.md)
- [Behavior evaluation and regression cases](docs/psychological-support-evaluation-cases.md)

These documents set product behavior boundaries; they do not establish clinical effectiveness or mean the test cases have passed. Run the evaluation cases against the actual candidate runtime after changes to the system prompt or conversation flow. The protocol and runtime prompt must be kept aligned.


## Subscriptions and referrals

The Telegram bot supports a 20-reply free quota, a 30-day/300-reply paid entitlement, Telegram Stars payment handling, and referral rewards. Read [subscription/referral setup and testing](docs/subscriptions-and-referrals.md).

Apply `supabase/migrations/20261017000100_between_subscriptions_referrals.sql` in Supabase SQL Editor **before** deploying the updated `telegram-bot` function. The purchase button remains disabled until `BETWEEN_SUBSCRIPTION_PRICE_STARS` is configured. Paid access is currently a one-time 30-day purchase, not automatic recurring billing.
