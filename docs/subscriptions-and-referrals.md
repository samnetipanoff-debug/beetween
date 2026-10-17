# BETWEEN Plus, free quota, and referrals

## Product rules

- New users receive 20 free AI replies.
- A paid purchase grants 30 days of premium access and 300 AI replies.
- A successful referral grants the inviter 7 additional days and 70 AI replies.
- A referral qualifies after the invited user has received 5 successful AI replies from BETWEEN.
- Referral bonuses are granted once per referred Telegram account. Self-referrals and referrals registered after the invitee has used free replies or received premium access are rejected.
- Menu actions, mood tracking, mood history/statistics, settings, saved-memory management, and BETWEEN news do not consume AI replies.
- Subscription renewal is a new one-time Telegram Stars purchase; automatic recurring billing is not implemented.
- The subscription price is intentionally unset until the product owner chooses it.

## Database setup

1. Open the Supabase project `cijjzrofrbneatapcpqr`.
2. Open **SQL Editor** and run the complete migration:
   [`supabase/migrations/20261017000100_between_subscriptions_referrals.sql`](../supabase/migrations/20261017000100_between_subscriptions_referrals.sql)
3. Verify that the following tables exist: `bot_entitlements`, `bot_referrals`, and `bot_payments`.
4. Do not deploy the updated Telegram Edge Function before the migration is applied. The function calls RPCs introduced by this migration.

The migration enables RLS on the new tables and grants the new RPC functions to `service_role` only. The bot already uses the Supabase service-role key server-side; never expose it to clients.

## Configure the price

Once a price has been chosen, set a positive whole-number Telegram Stars amount as an Edge Function secret:

```sh
supabase secrets set BETWEEN_SUBSCRIPTION_PRICE_STARS=500 --project-ref cijjzrofrbneatapcpqr
```

Replace `500` with the chosen amount. This is an example, not a recommendation. If the secret is absent, zero, or invalid, the purchase button stays disabled and the bot explains that pricing is not configured.

Telegram Stars payments use currency `XTR` and an empty provider token. The bot validates the invoice payload, Telegram account, currency, and amount during pre-checkout and again after successful payment. Payment charge IDs are stored uniquely so the same Telegram payment cannot grant the entitlement twice.

## Deploy and test

After applying the SQL migration and setting the price, deploy only the Telegram function:

```sh
supabase functions deploy telegram-bot --project-ref cijjzrofrbneatapcpqr
```

Do not deploy the separate `chat-with-psychologist` function for this change.

Test with a private test account before announcing availability:

1. `/start` creates an entitlement with 20 free AI replies.
2. Each successful AI reply decrements exactly one reply; menu actions do not.
3. At zero free replies, the bot does not call OpenRouter and displays subscription/referral options.
4. A failed AI request refunds the reserved reply.
5. The subscription screen shows the configured price and sends a Telegram Stars invoice.
6. A successful test payment adds 30 days and 300 replies; replaying the same payment update does not grant a second entitlement.
7. A valid referral is recorded once; the inviter receives 7 days and 70 replies after the invitee receives five successful AI replies.
8. A self-referral, duplicate referral, or referral after the invitee has consumed free replies does not qualify.
9. Mood diary, mood history/statistics, saved memory, settings, and news still work when the AI quota is empty.

## Important operational notes

- The code and migration in GitHub do not mean the production Supabase database or Edge Function has been updated. Apply and deploy explicitly.
- Test Stars purchases in a controlled way before advertising the feature to real users.
- The implementation adds quota/referral tables but does not alter existing conversation, memory, mood, or news tables.
- The current webhook relies on Telegram's configured webhook URL and existing server-side credentials. Do not log payment payloads containing user identifiers or any secret values.
