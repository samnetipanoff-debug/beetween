import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BETWEEN_SUBSCRIPTION_PRICE_STARS = Number(Deno.env.get("BETWEEN_SUBSCRIPTION_PRICE_STARS") || 0);

if (!TELEGRAM_BOT_TOKEN || !OPENROUTER_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// TELEGRAM
async function telegramRequest(method: string, body: any) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram error: ${response.status} ${errorText}`);
  }
  return await response.json();
}

// GET UNREAD NEWS COUNT
async function getUnreadNewsCount(userId: string) {
  const { data: news, error: newsError } = await supabase.from("bot_news").select("id");
  if (newsError) {
    console.error("Load news failed:", newsError.message, newsError.details, newsError.hint, newsError.code);
    return 0;
  }
  console.log("Total news:", news?.length || 0);
  const { data: readNews, error: readError } = await supabase.from("bot_news_read").select("news_id").eq("user_id", userId);
  if (readError) {
    console.error("Load read news failed:", readError.message, readError.details, readError.hint, readError.code);
    return 0;
  }
  console.log("Read news:", readNews?.length || 0);
  const readIds = new Set((readNews || []).map((item) => item.news_id));
  const unreadCount = (news || []).filter((item) => !readIds.has(item.id)).length;
  console.log("Unread news:", unreadCount, "User:", userId);
  return unreadCount;
}

// SHOW BETWEEN NEWS
async function showBotNews(chatId: number | string, userId: string) {
  const { data: news, error } = await supabase.from("bot_news").select("id, title, content, created_at").order("created_at", { ascending: false }).limit(10);
  if (error) {
    console.error("Load bot news failed:", error.message, error.details, error.hint, error.code);
    await sendTelegramMessage(chatId, "❌ Не удалось загрузить новости BETWEEN. Попробуй ещё раз.", true);
    return;
  }
  if (!news || news.length === 0) {
    await sendTelegramMessage(chatId, "📰 Новости BETWEEN\n\nПока обновлений нет.", true);
    return;
  }

  // MARK NEWS AS READ
  for (const item of news) {
    const { error } = await supabase.from("bot_news_read").upsert({ user_id: userId, news_id: item.id }, { onConflict: "user_id,news_id" });
    if (error) console.error("Mark news as read failed:", error.message, error.details, error.hint, error.code);
  }

  let message = "📰 Новости BETWEEN\n\n";
  for (const item of news) {
    const date = new Date(item.created_at).toLocaleDateString("ru-RU");
    message += `🧠 ${item.title}\n\n${item.content}\n\n📅 ${date}\n\n━━━━━━━━━━━━━━\n\n`;
  }
  await sendTelegramMessage(chatId, message, true);
}

// SEND TELEGRAM MESSAGE
async function sendTelegramMessage(chatId: number | string, text: string, withMenu = true, replyMarkup: any = null, userId: string | null = null) {
  const body: any = { chat_id: chatId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  } else if (withMenu) {
    let newsButtonText = "📰 Новости BETWEEN";
    if (userId) {
      const unreadNewsCount = await getUnreadNewsCount(userId);
      if (unreadNewsCount > 0) newsButtonText = `📰 Новости BETWEEN (${unreadNewsCount})`;
    }
    body.reply_markup = {
      keyboard: [
        [{ text: "💬 Поговорить" }, { text: "🧠 Что ты обо мне знаешь" }],
        [{ text: "🌿 Моё состояние" }, { text: "📊 Моя история состояния" }],
        [{ text: "📈 Моя статистика" }, { text: "⚙️ Настройки" }],
        [{ text: "💎 Подписка" }, { text: "🎁 Пригласить друга" }],
        [{ text: "📊 Мой доступ" }],
        [{ text: newsButtonText }],
        [{ text: "🆘 Помощь" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  await telegramRequest("sendMessage", body);
}

// OPENROUTER
async function callOpenRouter(messages: any[]) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://between.ai",
      "X-Title": "BETWEEN",
    },
    body: JSON.stringify({ model: "openai/gpt-chat-latest", messages, max_tokens: 450, temperature: 0.5 }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned empty response");
  return content;
}

// PARSE AI JSON
function parseAIResponse(text: string) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^\x60\x60\x60json\s*/i, "").replace(/^\x60\x60\x60\s*/i, "").replace(/\s*\x60\x60\x60$/, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    const jsonText = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      console.error("AI JSON parse failed; trying to recover answer:", error);
      const answerMatch = jsonText.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)"/s);
      if (answerMatch) {
        try {
          return { answer: JSON.parse('"' + answerMatch[1] + '"'), memory: { should_save: false } };
        } catch {
          // Fall through to a safe user-facing response.
        }
      }
      return {
        answer: "Извини, сейчас не получилось сформировать ответ. Попробуй, пожалуйста, ещё раз.",
        memory: { should_save: false },
      };
    }
  }

  // Some providers may ignore the JSON-only instruction; preserve plain-text answers.
  return { answer: cleaned, memory: { should_save: false } };
}

// TELEGRAM USER
async function getOrCreateTelegramUser(telegramUser: any) {
  const telegramId = telegramUser.id;
  const { data: existingUser, error: findError } = await supabase.from("telegram_users").select("*").eq("telegram_id", telegramId).maybeSingle();
  if (findError) throw new Error(`Find Telegram user failed: ${findError.message}`);
  if (existingUser) {
    await supabase.from("telegram_users").update({
      username: telegramUser.username ?? null,
      first_name: telegramUser.first_name ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", existingUser.id);
    return existingUser;
  }
  const { data: newUser, error: insertError } = await supabase.from("telegram_users").insert({
    telegram_id: telegramId,
    username: telegramUser.username ?? null,
    first_name: telegramUser.first_name ?? null,
  }).select().single();
  if (insertError) throw new Error(`Create Telegram user failed: ${insertError.message}`);
  return newUser;
}

// SESSION
async function getOrCreateSession(userId: string) {
  const { data: existingSession, error } = await supabase.from("sessions").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Find session failed: ${error.message}`);
  if (existingSession) return existingSession;
  const { data: newSession, error: insertError } = await supabase.from("sessions").insert({ user_id: userId, title: "BETWEEN" }).select().single();
  if (insertError) throw new Error(`Create session failed: ${insertError.message}`);
  return newSession;
}

// MEMORIES
async function loadMemories(userId: string) {
  const { data, error } = await supabase.from("memories").select("id, content, category, importance").eq("user_id", userId).order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(6);
  if (error) throw new Error(`Load memories failed: ${error.message}`);
  return data ?? [];
}

// RECENT MESSAGES
async function loadRecentMessages(sessionId: string) {
  const { data, error } = await supabase.from("messages").select("role, content").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(8);
  if (error) throw new Error(`Load messages failed: ${error.message}`);
  return (data ?? []).reverse();
}

// SAVE MESSAGE
async function saveMessage(sessionId: string, userId: string, role: string, content: string) {
  const { error } = await supabase.from("messages").insert({ session_id: sessionId, user_id: userId, role, content });
  if (error) throw new Error(`Save message failed: ${error.message}`);
}

// SAVE MEMORY
async function saveMemory(userId: string, memory: any) {
  if (!memory || memory.should_save !== true) {
    console.log("No memory to save");
    return;
  }
  if (!memory.content || typeof memory.content !== "string") {
    console.log("Memory content missing");
    return;
  }
  const categories = ["relocation", "location", "work", "family", "relationships", "goals", "preferences", "life", "other"];
  const category = categories.includes(memory.category) ? memory.category : "other";
  // The database stores importance on a 0..1 scale, while the AI prompt uses 1..3.
  const aiImportance = typeof memory.importance === "number" ? memory.importance : 2;
  const importance = Math.max(0, Math.min(1, (aiImportance - 1) / 2));
  const { error } = await supabase.from("memories").insert({
    user_id: userId,
    content: memory.content.trim(),
    category,
    importance,
  });
  if (error) {
    console.error("Save memory failed:", error);
    return;
  }
  console.log("Memory saved:", memory.content);
}


// SUBSCRIPTIONS, QUOTAS, AND REFERRALS
function configuredStarsPrice() {
  return Number.isSafeInteger(BETWEEN_SUBSCRIPTION_PRICE_STARS) && BETWEEN_SUBSCRIPTION_PRICE_STARS > 0
    ? BETWEEN_SUBSCRIPTION_PRICE_STARS
    : null;
}

async function ensureBotEntitlement(userId: string) {
  const { error } = await supabase.rpc("ensure_bot_entitlement", { p_user_id: userId });
  if (error) throw new Error(`Ensure entitlement failed: ${error.message}`);
}

async function showAccessStatus(chatId: number | string, userId: string) {
  await ensureBotEntitlement(userId);
  const { data, error } = await supabase.from("bot_entitlements")
    .select("free_replies_remaining, premium_replies_remaining, premium_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Load entitlement failed: ${error.message}`);

  const now = Date.now();
  const premiumActive = !!data?.premium_expires_at && new Date(data.premium_expires_at).getTime() > now;
  const expiry = premiumActive
    ? new Date(data.premium_expires_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
    : null;
  const text = premiumActive
    ? `💎 Твой доступ BETWEEN\n\nПодписка активна до: ${expiry}\nОсталось AI-ответов: ${data.premium_replies_remaining}\nБесплатных ответов: ${data.free_replies_remaining}`
    : `💎 Твой доступ BETWEEN\n\nБесплатных AI-ответов осталось: ${data?.free_replies_remaining ?? 0}\nБонусных/платных AI-ответов: ${data?.premium_replies_remaining ?? 0}\n\n${data?.premium_replies_remaining > 0 ? "Премиум-лимит сейчас недоступен или срок доступа истёк." : "Чтобы продолжить разговоры, оформи подписку или пригласи друга."}`;
  await sendTelegramMessage(chatId, text, true, { inline_keyboard: [
    [{ text: "💎 Подписка", callback_data: "subscription" }],
    [{ text: "🎁 Пригласить друга", callback_data: "referral" }],
  ] });
}

async function showSubscription(chatId: number | string, userId: string) {
  await ensureBotEntitlement(userId);
  const price = configuredStarsPrice();
  const keyboard: any[] = [];
  if (price) keyboard.push([{ text: `⭐ Купить 30 дней — ${price} Stars`, callback_data: "subscription_buy" }]);
  keyboard.push([{ text: "📊 Мой доступ", callback_data: "access_status" }]);
  keyboard.push([{ text: "🎁 Пригласить друга", callback_data: "referral" }]);
  const priceText = price
    ? `Стоимость: ${price} Telegram Stars за 30 дней.\n`
    : "Стоимость пока настраивается, покупка ещё не доступна.\n";
  const text = `💎 BETWEEN Plus\n\n30 дней доступа и 300 AI-ответов.\n${priceText}\nЕсли срок подписки ещё действует, новая покупка продлит его на 30 дней и добавит ещё 300 AI-ответов. Продление не списывается автоматически.\n\nПриглашай друзей, чтобы получать бонусные дни.`;
  await sendTelegramMessage(chatId, text, true, { inline_keyboard: keyboard });
}

async function showReferralInfo(chatId: number | string, userId: string) {
  const { data, error } = await supabase.from("bot_referrals")
    .select("id, bonus_granted, qualifying_ai_replies")
    .eq("referrer_user_id", userId);
  if (error) throw new Error(`Load referrals failed: ${error.message}`);

  const me = await telegramRequest("getMe", {});
  const username = me?.result?.username;
  if (!username) throw new Error("Could not determine Telegram bot username");
  const link = `https://t.me/${username}?start=ref_${userId}`;
  const referrals = data ?? [];
  const rewarded = referrals.filter((r: any) => r.bonus_granted).length;
  const inProgress = referrals.filter((r: any) => !r.bonus_granted).length;
  const text = `🎁 Приглашай друзей в BETWEEN\n\nТвоя персональная ссылка:\n${link}\n\nЗа каждого приглашённого друга ты получишь +7 дней доступа и 70 AI-ответов, когда BETWEEN ответит ему 5 раз.\n\nПриглашено: ${referrals.length}\nБонус начислен: ${rewarded}\nОжидают активации: ${inProgress}\n\nБонус начисляется один раз за нового пользователя. Самоприглашения и повторные бонусы не засчитываются.`;
  await sendTelegramMessage(chatId, text, true, { inline_keyboard: [
    [{ text: "📊 Мой доступ", callback_data: "access_status" }],
    [{ text: "💎 Подписка", callback_data: "subscription" }],
  ] });
}

function parseBetweenInvoicePayload(payload: string) {
  const match = /^between30_([0-9a-f-]{36})_(\d+)_(\d+)$/.exec(payload);
  if (!match) return null;
  const price = Number(match[2]);
  const timestamp = Number(match[3]);
  if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(timestamp)) return null;
  return { userId: match[1], price, timestamp };
}

async function sendSubscriptionInvoice(chatId: number | string, userId: string) {
  const price = configuredStarsPrice();
  if (!price) {
    await sendTelegramMessage(chatId, "Стоимость подписки пока настраивается. Покупка станет доступна после публикации цены.", true);
    return;
  }
  const payload = `between30_${userId}_${price}_${Date.now()}`;
  await telegramRequest("sendInvoice", {
    chat_id: chatId,
    title: "BETWEEN Plus — 30 дней",
    description: "30 дней доступа к AI-разговорам и 300 AI-ответов.",
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: "BETWEEN Plus — 30 дней", amount: price }],
  });
}

async function handlePreCheckoutQuery(preCheckoutQuery: any) {
  const id = preCheckoutQuery?.id;
  const fromId = preCheckoutQuery?.from?.id;
  const payload = typeof preCheckoutQuery?.invoice_payload === "string" ? preCheckoutQuery.invoice_payload : "";
  const parsed = parseBetweenInvoicePayload(payload);
  let ok = false;
  let errorMessage = "Не удалось проверить оплату. Вернись в BETWEEN и попробуй снова.";

  if (parsed && fromId && preCheckoutQuery.currency === "XTR" && preCheckoutQuery.total_amount === parsed.price) {
    const { data: user, error } = await supabase.from("telegram_users")
      .select("id")
      .eq("telegram_id", fromId)
      .maybeSingle();
    if (!error && user?.id === parsed.userId) {
      ok = true;
      errorMessage = "";
    }
  }
  await telegramRequest("answerPreCheckoutQuery", ok
    ? { pre_checkout_query_id: id, ok: true }
    : { pre_checkout_query_id: id, ok: false, error_message: errorMessage });
}

async function handleSuccessfulPayment(message: any) {
  const chatId = message?.chat?.id;
  const telegramUser = message?.from;
  const payment = message?.successful_payment;
  if (!chatId || !telegramUser || !payment) return;

  const user = await getOrCreateTelegramUser(telegramUser);
  const parsed = parseBetweenInvoicePayload(String(payment.invoice_payload ?? ""));
  if (!parsed || parsed.userId !== user.id || payment.currency !== "XTR" || payment.total_amount !== parsed.price) {
    await sendTelegramMessage(chatId, "Не удалось подтвердить параметры платежа автоматически. Напиши в поддержку BETWEEN, не оплачивай повторно.", true);
    console.error("Invalid successful payment payload/details", { userId: user.id, currency: payment.currency, total_amount: payment.total_amount });
    return;
  }

  const { data, error } = await supabase.rpc("process_bot_stars_payment", {
    p_user_id: user.id,
    p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
    p_provider_payment_charge_id: payment.provider_payment_charge_id ?? "",
    p_currency: payment.currency,
    p_total_amount: payment.total_amount,
    p_invoice_payload: payment.invoice_payload,
  });
  if (error) throw new Error(`Process Stars payment failed: ${error.message}`);

  if (data?.processed) {
    await sendTelegramMessage(chatId, "Оплата прошла успешно! 💎\n\nТебе начислены 30 дней BETWEEN Plus и 300 AI-ответов. Спасибо за поддержку проекта.", true);
  } else {
    await sendTelegramMessage(chatId, "Этот платёж уже был обработан. Проверь свой доступ в разделе «📊 Мой доступ».", true);
  }
}

// MOOD DIARY
async function startMoodDiary(chatId: number | string) {
  const keyboard = { inline_keyboard: [
    [{ text: "😞 Очень плохо", callback_data: "mood_1" }],
    [{ text: "😕 Плохо", callback_data: "mood_2" }],
    [{ text: "😐 Нормально", callback_data: "mood_3" }],
    [{ text: "🙂 Хорошо", callback_data: "mood_4" }],
    [{ text: "😊 Очень хорошо", callback_data: "mood_5" }],
  ] };
  await sendTelegramMessage(chatId, "🌿 Как ты себя сейчас чувствуешь?\n\nВыбери вариант, который ближе всего к твоему состоянию.", false, keyboard);
}

// SAVE MOOD
async function saveMood(userId: string, mood: number, note: string | null) {
  const { error } = await supabase.from("mood").insert({ user_id: userId, mood, note });
  if (error) throw new Error(`Save mood failed: ${error.message}`);
}

// PENDING MOOD
async function setPendingMood(userId: string, mood: number) {
  const { error } = await supabase.from("mood_pending").upsert({ user_id: userId, mood, created_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`Set pending mood failed: ${error.message}`);
}
async function getPendingMood(userId: string) {
  const { data, error } = await supabase.from("mood_pending").select("mood").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Get pending mood failed: ${error.message}`);
  return data;
}
async function clearPendingMood(userId: string) {
  const { error } = await supabase.from("mood_pending").delete().eq("user_id", userId);
  if (error) throw new Error(`Clear pending mood failed: ${error.message}`);
}

// ASK FOR NOTE
async function askForMoodNote(chatId: number | string) {
  const keyboard = { inline_keyboard: [[{ text: "Пропустить", callback_data: "mood_skip" }]] };
  await sendTelegramMessage(chatId, "Хочешь добавить пару слов о том, почему ты сейчас так себя чувствуешь?\n\nНапиши их сообщением или нажми «Пропустить».", false, keyboard);
}

// SAVE MOOD AND FINISH
async function saveMoodAndFinish(chatId: number | string, userId: string, mood: number, note: string | null) {
  await saveMood(userId, mood, note);
  await clearPendingMood(userId);
  const responses: Record<number, string> = {
    1: "Спасибо, что отметил это. 🤍 Сейчас тебе действительно может быть непросто. Не обязательно что-то исправлять прямо сейчас.",
    2: "Спасибо, что отметил своё состояние. 🤍 Иногда уже полезно просто заметить и признать, что сегодня тяжело.",
    3: "Спасибо. 🌿 Иногда «нормально» — это тоже вполне настоящее состояние. Можно просто оставить эту отметку здесь.",
    4: "Хорошо. 🌿 Рад, что сегодня тебе немного легче.",
    5: "Здорово это слышать. 😊 Сохраним этот момент.",
  };
  await sendTelegramMessage(chatId, responses[mood] ?? "Спасибо, что отметил своё состояние. 🌿", true);
}

// MOOD HISTORY
async function showMoodHistory(chatId: number | string, userId: string) {
  const { data, error } = await supabase.from("mood").select("mood, note, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(7);
  if (error) throw new Error(`Load mood history failed: ${error.message}`);
  if (!data || data.length === 0) {
    await sendTelegramMessage(chatId, "🌿 У тебя пока нет записей в дневнике состояния.", true);
    return;
  }
  const moodLabels: Record<number, string> = { 1: "😞 Очень плохо", 2: "😕 Плохо", 3: "😐 Нормально", 4: "🙂 Хорошо", 5: "😊 Очень хорошо" };
  const lines = data.map((entry: any) => {
    const date = new Date(entry.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    const note = entry.note ? ` — ${entry.note}` : "";
    return `${date} — ${moodLabels[entry.mood] ?? entry.mood}${note}`;
  });
  await sendTelegramMessage(chatId, "🌿 Последние записи:\n\n" + lines.join("\n"), true);
}

// MOOD STATISTICS
async function showMoodStatistics(chatId: number | string, userId: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("mood").select("mood, created_at").eq("user_id", userId).gte("created_at", sevenDaysAgo).order("created_at", { ascending: true });
  if (error) throw new Error(`Load mood statistics failed: ${error.message}`);
  if (!data || data.length === 0) {
    await sendTelegramMessage(chatId, "📈 За последние 7 дней пока нет записей состояния.", true);
    return;
  }
  const count = data.length;
  const average = data.reduce((sum: number, entry: any) => sum + entry.mood, 0) / count;
  const goodDays = data.filter((entry: any) => entry.mood >= 4).length;
  const difficultDays = data.filter((entry: any) => entry.mood <= 2).length;
  let averageLabel = "😐 Нормально";
  if (average < 2) averageLabel = "😞 Очень тяжело";
  else if (average < 3) averageLabel = "😕 Скорее тяжело";
  else if (average < 4) averageLabel = "😐 Нормально";
  else if (average < 5) averageLabel = "🙂 Скорее хорошо";
  else averageLabel = "😊 Очень хорошо";
  const text = `📈 Твоё состояние за последние 7 дней\n\nЗаписей: ${count}\nСреднее состояние: ${average.toFixed(1)} / 5 — ${averageLabel}\n\nХорошее состояние: ${goodDays}\nТяжёлое состояние: ${difficultDays}`;
  await sendTelegramMessage(chatId, text, true);
}

// MENU ACTIONS
async function showMemories(chatId: number | string, userId: string) {
  const memories = await loadMemories(userId);
  if (memories.length === 0) {
    await sendTelegramMessage(chatId, "🧠 Пока я ничего важного о тебе не запомнил.", true);
    return;
  }
  const keyboard: any[] = memories.map((memory: any) => [{ text: `🗑 ${memory.content}`, callback_data: `memory_delete_${memory.id}` }]);
  keyboard.push([{ text: "🗑 Очистить всю память", callback_data: "memory_delete_all" }]);
  await sendTelegramMessage(chatId, "🧠 Что я знаю о тебе:\n\nВыбери факт, который хочешь удалить:", true, { inline_keyboard: keyboard });
}

async function handleMenuAction(chatId: number | string, userId: string, text: string) {
  if (text === "💬 Поговорить") {
    await sendTelegramMessage(chatId, "Я здесь. Расскажи, что сейчас происходит.", true);
    return true;
  }
  if (text === "🧠 Что ты обо мне знаешь") {
    await showMemories(chatId, userId);
    return true;
  }
  if (text === "🌿 Моё состояние") {
    await startMoodDiary(chatId);
    return true;
  }
  if (text === "📊 Моя история состояния") {
    await showMoodHistory(chatId, userId);
    return true;
  }
  if (text === "📈 Моя статистика") {
    await showMoodStatistics(chatId, userId);
    return true;
  }
  if (text === "⚙️ Настройки") {
    await sendTelegramMessage(chatId, "⚙️ Настройки\n\nВыбери, что хочешь настроить:", true, { inline_keyboard: [
      [{ text: "🧠 Управление памятью", callback_data: "settings_memory" }],
      [{ text: "🌐 Язык", callback_data: "settings_language" }],
      [{ text: "🗑 История", callback_data: "settings_history" }],
    ] });
    return true;
  }
  if (text === "📰 Новости BETWEEN" || text.startsWith("📰 Новости BETWEEN (")) {
    await showBotNews(chatId, userId);
    return true;
  }
  if (text === "💎 Подписка") {
    await showSubscription(chatId, userId);
    return true;
  }
  if (text === "🎁 Пригласить друга") {
    await showReferralInfo(chatId, userId);
    return true;
  }
  if (text === "📊 Мой доступ") {
    await showAccessStatus(chatId, userId);
    return true;
  }
  if (text === "🆘 Помощь") {
    await sendTelegramMessage(chatId, "🆘 BETWEEN — это пространство для спокойного разговора и поддержки во время переезда и адаптации.\n\nЯ не врач и не заменяю профессиональную помощь.\n\nЕсли тебе прямо сейчас угрожает опасность, обратись в местную экстренную службу или к человеку, которому доверяешь.", true);
    return true;
  }
  return false;
}

// HANDLE START
async function handleStart(chatId: number | string, telegramUser: any, startPayload = "") {
  const firstName = telegramUser?.first_name;
  const user = await getOrCreateTelegramUser(telegramUser);
  await ensureBotEntitlement(user.id);
  let referralAccepted = false;
  const refMatch = /^ref_([0-9a-f-]{36})$/i.exec(startPayload);
  if (refMatch) {
    const { data, error } = await supabase.rpc("register_bot_referral", {
      p_referrer_user_id: refMatch[1],
      p_referred_user_id: user.id,
    });
    if (error) {
      console.error("Register referral failed:", error.message);
    } else {
      referralAccepted = data === true;
    }
  }
  const greeting = firstName ? `Привет, ${firstName} 👋` : "Привет 👋";
  const text = `${greeting}

Я BETWEEN.

Это спокойное пространство, где можно говорить о том, что происходит с тобой после переезда, адаптации и изменений в жизни.

Здесь не нужно подбирать правильные слова.

Просто расскажи, что у тебя сейчас на душе. 🤍`;
  const welcomeText = referralAccepted
    ? `${text}\n\n🎁 Тебя пригласили в BETWEEN. Когда ты отправишь 5 AI-сообщений, пригласивший тебя человек получит бонусный доступ.`
    : text;
  await sendTelegramMessage(chatId, welcomeText, true, null, user.id);
}

// MAIN AI CHAT
async function handleAIChat(chatId: number | string, userId: string, userText: string) {
  await ensureBotEntitlement(userId);
  const { data: access, error: accessError } = await supabase.rpc("consume_bot_ai_reply", { p_user_id: userId });
  if (accessError) throw new Error(`Check/consume AI quota failed: ${accessError.message}`);
  if (!access?.allowed) {
    await sendTelegramMessage(chatId,
      "Ты использовал бесплатные AI-ответы BETWEEN. 🤍\n\nЧтобы продолжить разговор, оформи BETWEEN Plus на 30 дней или пригласи друга и получи бонусный доступ.",
      true,
      { inline_keyboard: [
        [{ text: "💎 Подписка", callback_data: "subscription" }],
        [{ text: "🎁 Пригласить друга", callback_data: "referral" }],
        [{ text: "📊 Мой доступ", callback_data: "access_status" }],
      ] }
    );
    return;
  }

  const accessType = access.access_type;
  let replySent = false;
  try {
    const session = await getOrCreateSession(userId);
    await saveMessage(session.id, userId, "user", userText);
    const memories = await loadMemories(userId);
  const memoryText = memories.length > 0 ? memories.map((m: any) => `[${m.category}] ${m.content}`).join("\n") : "Нет сохранённых фактов.";
  const history = await loadRecentMessages(session.id);

  const systemPrompt = `
You are BETWEEN, a non-clinical emotional-support companion for people adapting to life in another country. You are not a licensed psychologist, psychotherapist, doctor, or crisis service. Do not diagnose or claim to provide therapy.

CORE RULES:
1. Follow the user's actual message and conversation context. Answer direct questions directly. If the user says you missed the point, repair that specific miss before asking anything else. If unclear, ask what point was missed.
2. Do not infer hidden motives, diagnoses, personality traits, or unexpressed feelings as facts. Reflect only what was said; any interpretation must be tentative and easy to reject.
3. Mentioning work, money, family, or relocation is not a request for advice. Do not switch to coaching, planning, exercises, or problem-solving unless asked or the user agrees. If their preferred response is unclear, ask one brief, neutral question or simply listen.
4. Use respectful, collaborative, concise supportive listening. Do not force optimism, reframing, gratitude, or reassurance. Do not treat real external problems as thinking errors. Do not routinely summarize the whole story, list guessed emotions, or end every reply with a question.
5. Do not diagnose, assess clinically, process trauma, prescribe treatment, recommend medication changes, invent studies/citations/statistics, or claim a technique is guaranteed or best for this person. Offer simple structured techniques only when relevant and with consent where practical. Be honest about uncertainty.
6. Respect autonomy, privacy, culture, and the right not to disclose or continue. Do not shame, manipulate, create dependency, or promise confidentiality beyond verified product practices. Correct mistakes briefly and specifically.
7. If the user indicates imminent danger, self-harm intent, or inability to stay safe, prioritize immediate safety: ask about immediate danger if needed, encourage local emergency services and a trusted person who can be physically present. No guilt, debate, generic positivity, or claims that you can call for help. If distress is persistent, severe, worsening, or disrupts daily life, gently suggest a qualified professional without abandoning the conversation.

STYLE: Respond to the user's current need in natural, concise language, usually 2–5 sentences. Ask at most one question, only when useful. Sometimes a direct answer or acknowledgment is enough. Use plain text only: do not use Markdown formatting, bold/italic markers, or asterisks for emphasis.

MEMORY: Save only stable, useful personal facts explicitly disclosed by the user (location, relocation, work, family, relationships, long-term goals, preferences, enduring life circumstances). Never save temporary mood, one-time events, questions, or short-term plans. Do not infer facts. If no stable fact is stated, set should_save=false.

Return ONLY valid JSON:
{"answer":"short natural response","memory":{"should_save":false}}
If a stable fact is explicitly stated, use {"answer":"...","memory":{"should_save":true,"content":"short factual statement","category":"relocation|location|work|family|relationships|goals|preferences|life|other","importance":1|2|3}}.
Importance: 1 useful, 2 important, 3 very important.

CURRENT MEMORY:
${memoryText}
`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...history.map((m: any) => ({ role: m.role, content: m.content })),
    ];
    console.log("Calling OpenRouter...");
    const aiRaw = await callOpenRouter(aiMessages);
    console.log("OpenRouter response received");
    const result = parseAIResponse(aiRaw);
    const answer = typeof result.answer === "string"
      ? result.answer.trim().replace(/\*\*(.*?)\*\*/gs, "$1").replace(/__(.*?)__/gs, "$1")
      : "";
    if (!answer) throw new Error("AI answer is empty");
    await saveMemory(userId, result.memory);
    await saveMessage(session.id, userId, "assistant", answer);
    await supabase.from("sessions").update({ updated_at: new Date().toISOString() }).eq("id", session.id);
    await sendTelegramMessage(chatId, answer, true);
    replySent = true;
  } catch (error) {
    const { error: refundError } = await supabase.rpc("refund_bot_ai_reply", {
      p_user_id: userId,
      p_access_type: accessType,
    });
    if (refundError) console.error("Could not refund AI reply quota:", refundError.message);
    throw error;
  }

  if (replySent) {
    const { data: referralResult, error: referralError } = await supabase.rpc("record_bot_referral_ai_reply", {
      p_referred_user_id: userId,
    });
    if (referralError) {
      console.error("Record referral activity failed:", referralError.message);
    } else if (referralResult?.bonus_granted && referralResult?.referrer_user_id) {
      try {
        const { data: referrer } = await supabase.from("telegram_users")
          .select("telegram_id")
          .eq("id", referralResult.referrer_user_id)
          .maybeSingle();
        if (referrer?.telegram_id) {
          await sendTelegramMessage(
            referrer.telegram_id,
            "🎁 Твой друг активировал BETWEEN! Тебе начислены +7 дней доступа и 70 AI-ответов. Спасибо, что приглашаешь друзей. 🤍",
            false
          );
        }
      } catch (notificationError) {
        console.error("Referral bonus notification failed:", notificationError);
      }
    }
  }
}

// CALLBACK QUERY
async function handleCallbackQuery(update: any) {
  const callbackQuery = update?.callback_query;
  if (!callbackQuery) return false;
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery?.message?.chat?.id;
  const telegramUser = callbackQuery.from;
  const data = callbackQuery.data;
  if (!chatId || !telegramUser) return true;
  const user = await getOrCreateTelegramUser(telegramUser);
  await telegramRequest("answerCallbackQuery", { callback_query_id: callbackId });

  if (data === "subscription") {
    await showSubscription(chatId, user.id);
    return true;
  }

  if (data === "subscription_buy") {
    await sendSubscriptionInvoice(chatId, user.id);
    return true;
  }

  if (data === "referral") {
    await showReferralInfo(chatId, user.id);
    return true;
  }

  if (data === "access_status") {
    await showAccessStatus(chatId, user.id);
    return true;
  }

  if (data === "settings_memory") {
    await showMemories(chatId, user.id);
    return true;
  }

  if (typeof data === "string" && data.startsWith("memory_delete_") && data !== "memory_delete_all" && data !== "memory_delete_all_confirm") {
    const memoryId = data.replace("memory_delete_", "");
    if (!memoryId) {
      await sendTelegramMessage(chatId, "Не удалось определить память для удаления.", true);
      return true;
    }
    const { error } = await supabase.from("memories").delete().eq("id", memoryId).eq("user_id", user.id);
    if (error) {
      console.error("Delete memory failed:", error);
      await sendTelegramMessage(chatId, "Не удалось удалить этот факт. Попробуй ещё раз.", true);
      return true;
    }
    await sendTelegramMessage(chatId, "🗑 Факт удалён.", true);
    await showMemories(chatId, user.id);
    return true;
  }

  if (data === "memory_delete_all") {
    await sendTelegramMessage(chatId, "⚠️ Ты действительно хочешь удалить всю память обо всех сохранённых фактах?\n\nЭто действие нельзя отменить.", true, { inline_keyboard: [
      [{ text: "🗑 Да, удалить всё", callback_data: "memory_delete_all_confirm" }],
      [{ text: "↩️ Отмена", callback_data: "settings_memory" }],
    ] });
    return true;
  }

  if (data === "memory_delete_all_confirm") {
    const { error } = await supabase.from("memories").delete().eq("user_id", user.id);
    if (error) {
      console.error("Delete all memories failed:", error.message, error.details, error.hint, error.code);
      await sendTelegramMessage(chatId, `❌ Ошибка очистки памяти:\n\n${error.message}\n\nКод: ${error.code || "нет"}`, true);
      return true;
    }
    await sendTelegramMessage(chatId, "🗑 Вся память очищена.", true);
    await showMemories(chatId, user.id);
    return true;
  }

  if (data === "settings_language") {
    await sendTelegramMessage(chatId, "🌐 Настройки языка добавим следующим этапом.", true);
    return true;
  }

  if (data === "settings_history") {
    await sendTelegramMessage(chatId, "🗑 История разговоров\n\nЗдесь хранится история твоих разговоров с BETWEEN.\n\nПамять 🧠 хранится отдельно и при удалении истории не удаляется.", true, { inline_keyboard: [
      [{ text: "🗑 Удалить всю историю", callback_data: "history_delete_all" }],
      [{ text: "↩️ Назад", callback_data: "settings_back" }],
    ] });
    return true;
  }

  if (data === "settings_back") {
    await sendTelegramMessage(chatId, "⚙️ Настройки\n\nВыбери, что хочешь настроить:", true, { inline_keyboard: [
      [{ text: "🧠 Управление памятью", callback_data: "settings_memory" }],
      [{ text: "🌐 Язык", callback_data: "settings_language" }],
      [{ text: "🗑 История", callback_data: "settings_history" }],
    ] });
    return true;
  }

  if (data === "history_delete_all") {
    await sendTelegramMessage(chatId, "⚠️ Ты действительно хочешь удалить всю историю разговоров?\n\nВсе сообщения твоих разговоров с BETWEEN будут удалены.\n\nПамять 🧠 при этом останется.", true, { inline_keyboard: [
      [{ text: "🗑 Да, удалить всё", callback_data: "history_delete_all_confirm" }],
      [{ text: "↩️ Отмена", callback_data: "settings_history" }],
    ] });
    return true;
  }

  if (data === "history_delete_all_confirm") {
    const { error } = await supabase.from("messages").delete().eq("user_id", user.id);
    if (error) {
      console.error("Delete all history failed:", error.message, error.details, error.hint, error.code);
      await sendTelegramMessage(chatId, `❌ Ошибка удаления истории:\n\n${error.message}\n\nКод: ${error.code || "нет"}`, true);
      return true;
    }
    await sendTelegramMessage(chatId, "🗑 Вся история разговоров удалена.\n\nПамять 🧠 сохранена.", true);
    return true;
  }

  if (typeof data === "string" && data.startsWith("mood_") && data !== "mood_skip") {
    const mood = Number(data.replace("mood_", ""));
    if (Number.isInteger(mood) && mood >= 1 && mood <= 5) {
      await setPendingMood(user.id, mood);
      await askForMoodNote(chatId);
    }
    return true;
  }

  if (data === "mood_skip") {
    const pendingMood = await getPendingMood(user.id);
    if (!pendingMood) {
      await sendTelegramMessage(chatId, "Начни с кнопки 🌿 Моё состояние.", true);
      return true;
    }
    await saveMoodAndFinish(chatId, user.id, pendingMood.mood, null);
    return true;
  }
  return true;
}

// MAIN WEBHOOK
Deno.serve(async (req) => {
  let incomingUpdate: any = null;
  try {
    if (req.method !== "POST") return new Response("OK", { status: 200 });
    incomingUpdate = await req.json();
    const update = incomingUpdate;

    if (update?.pre_checkout_query) {
      await handlePreCheckoutQuery(update.pre_checkout_query);
      return new Response("OK", { status: 200 });
    }

    if (update?.callback_query) {
      await handleCallbackQuery(update);
      return new Response("OK", { status: 200 });
    }

    const message = update?.message;
    if (!message?.chat?.id) return new Response("OK", { status: 200 });
    const telegramUser = message.from;
    const chatId = message.chat.id;

    if (message.successful_payment) {
      await handleSuccessfulPayment(message);
      return new Response("OK", { status: 200 });
    }

    const userText = typeof message.text === "string" ? message.text.trim() : "";
    if (!userText) return new Response("OK", { status: 200 });

    const user = await getOrCreateTelegramUser(telegramUser);
    const pendingMood = await getPendingMood(user.id);
    if (pendingMood) {
      await saveMoodAndFinish(chatId, user.id, pendingMood.mood, userText);
      return new Response("OK", { status: 200 });
    }

    if (/^\/start(?:@\w+)?(?:\s|$)/.test(userText)) {
      const startPayload = userText.split(/\s+/)[1] ?? "";
      await handleStart(chatId, telegramUser, startPayload);
      return new Response("OK", { status: 200 });
    }

    const isMenuAction = await handleMenuAction(chatId, user.id, userText);
    if (isMenuAction) return new Response("OK", { status: 200 });

    await handleAIChat(chatId, user.id, userText);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Telegram bot error:", error);
    const failedChatId = incomingUpdate?.message?.chat?.id ?? incomingUpdate?.callback_query?.message?.chat?.id;
    if (failedChatId) {
      try {
        await sendTelegramMessage(
          failedChatId,
          "Извини, сейчас возникла техническая ошибка. Попробуй ещё раз чуть позже."
        );
      } catch (notificationError) {
        console.error("Could not notify Telegram user about the error:", notificationError);
      }
    }
    // Telegram webhooks should receive 200 to avoid endless retries for a failed update.
    return new Response("OK", { status: 200 });
  }
});
