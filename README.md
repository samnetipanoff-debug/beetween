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
