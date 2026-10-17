# BETWEEN Plus, free quota, and referrals

## Product rules

- New users receive 20 free AI replies.
- Monthly plan: 990 Telegram Stars for 30 days and 300 AI replies.
- Annual plan: 5,590 Telegram Stars for 365 days; the 300-reply quota refreshes every 30 days while access is active.
- A successful referral grants the inviter 7 additional days and 70 AI replies.
- A referral qualifies after the invited user has received 5 successful AI replies from BETWEEN.
- Referral bonuses are granted once per referred Telegram account. Self-referrals and referrals registered after the invitee has used free replies or received premium access are rejected.
- Menu actions, mood tracking, mood history/statistics, settings, saved-memory management, and BETWEEN news do not consume AI replies.
- Purchases are one-time Telegram Stars payments; automatic recurring billing is not implemented.
- The bot records refund requests for support review. Telegram's Bot API can refund a Stars payment in full, but does not provide a partial refund amount for unused days. Submitting a request does not itself issue a refund or revoke access.

## Database setup

1. Open the Supabase project `cijjzrofrbneatapcpqr`.
2. Open **SQL Editor** and run the complete migration:
   [`supabase/migrations/20261017000100_between_subscriptions_referrals.sql`](../supabase/migrations/20261017000100_between_subscriptions_referrals.sql)
3. Then run `supabase/migrations/20261017000200_between_annual_and_refunds.sql`.
4. Verify that `bot_entitlements`, `bot_referrals`, `bot_payments`, and `bot_refund_requests` exist.
5. Do not deploy the updated Telegram Edge Function before both migrations are applied. The function calls RPCs introduced by these migrations.

The migration enables RLS on the new tables and grants the new RPC functions to `service_role` only. The bot already uses the Supabase service-role key server-side; never expose it to clients.

## Prices and cancellation/refund policy

Prices are currently configured in the Edge Function:
- Monthly: 990 Telegram Stars for 30 days.
- Annual: 5,590 Telegram Stars for 365 days.

The annual plan refreshes 300 AI replies every 30 days while access is active. It does not grant 3,600 replies immediately. Purchases are one-time and do not auto-renew, so users do not need to cancel future billing.

The bot offers a refund-review request and implements Telegram's required `/paysupport` command. A request is recorded in `bot_refund_requests`, but this code does not automatically approve or execute a refund. Support must review the request and process any approved full refund. Telegram's Bot API refunds a successful Stars payment in full; it does not support refunding only the prorated remainder for unused days. The bot explicitly tells the user that access is unchanged when a request is filed.

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
6. A monthly test payment adds 30 days; an annual test payment adds 365 days. Both provide a 300-reply quota, with the annual quota refreshing every 30 days. Replaying the same payment update does not grant a second entitlement.
7. A valid referral is recorded once; the inviter receives 7 days and 70 replies after the invitee receives five successful AI replies.
8. The refund button creates a pending review request only; it does not issue a refund or remove access. Duplicate pending requests are blocked.
9. A self-referral, duplicate referral, or referral after the invitee has consumed free replies does not qualify.
10. Mood diary, mood history/statistics, saved memory, settings, and news still work when the AI quota is empty.

## Important operational notes

- The code and migration in GitHub do not mean the production Supabase database or Edge Function has been updated. Apply and deploy explicitly.
- Test Stars purchases in a controlled way before advertising the feature to real users.
- The implementation adds quota/referral tables but does not alter existing conversation, memory, mood, or news tables.
- The current webhook relies on Telegram's configured webhook URL and existing server-side credentials. Do not log payment payloads containing user identifiers or any secret values.
