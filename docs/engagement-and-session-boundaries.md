# BETWEEN engagement and session-boundary policy

BETWEEN should earn repeat use through usefulness, trust, and user control—not emotional dependency.

## Product principles

- Never end a conversation at a positive emotional moment just to increase return visits or create a conditioned association with the bot.
- Never force a daily stop merely because the user has sent a certain number of messages. Enforce only transparent product limits (for example, the published AI-reply quota).
- Let the user choose whether to continue, pause, or finish.
- Offer a pause only when it is contextually helpful: a long/repetitive exchange, signs the user is tired, a user request to stop, or an explicit late-night reminder preference.
- Do not send guilt-inducing reminders, streak-loss warnings, artificial urgency, or messages implying that BETWEEN needs the user or understands them better than real people.
- Do not treat an improved mood as a reason to stop the conversation. Acknowledge the positive change, ask whether the user wants to reflect or finish only if useful, and respect the answer.
- Do not assume the user is better because they sound positive. Ask rather than infer when the distinction matters.

## Suggested implementation

### 1. User-controlled pause
The current implementation offers a low-pressure choice after 12 AI replies in a session, at most once per session:
“Мы уже довольно долго это обсуждаем. Хочешь продолжить, сделать паузу или коротко зафиксировать главное на потом?”

This is a suggestion, not a hard stop. The offer is recorded in `bot_session_pause_offers` and does not block subsequent messages. The user can continue or pause; the choice is stored for product evaluation.

### 2. Natural closing
If the user says they are done, help close with one or two sentences and optionally a short recap. Do not force a question or send an unsolicited follow-up.

### 3. Optional reminder
Only if the user explicitly opts in, allow a reminder at a time they choose. Make it easy to turn off. The reminder should be neutral (“Ты просил напомнить вернуться к разговору”), never imply emotional need or urgency.

### 4. User-requested session summary
Offer a short optional note the user can save or copy. Do not create a psychological score or claim the session caused improvement.

### 5. Retention metrics
Track only product-level metrics that are necessary: first-week return rate, conversations voluntarily resumed, subscription conversion, refund requests, and quota exhaustion. Avoid optimizing for conversation length alone. Audit complaints, unwanted advice, and user-reported pressure as quality metrics.

## Current implementation status

The system prompt in `supabase/functions/telegram-bot/index.ts` instructs the model not to force session endings or stop at a positive emotional moment for retention. A deterministic prompt is also implemented: after 12 AI replies, the bot offers a user-controlled continue/pause choice once per session. Apply `supabase/migrations/20261017000300_between_session_pause_offers.sql` before deploying the updated function. Opt-in reminders and session summaries are not implemented yet.
