import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      // CORS
      if (req.method === "OPTIONS") {
        return new Response("ok", {
          headers: corsHeaders,
        });
      }

      try {
        // --------------------------------------------------
        // 1. Получаем пользователя
        // --------------------------------------------------

        const user = ctx.userClaims;

        if (!user?.sub) {
          return new Response(
            JSON.stringify({
              error: "Unauthorized",
            }),
            {
              status: 401,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        const userId = user.sub;

        // --------------------------------------------------
        // 2. Получаем запрос
        // --------------------------------------------------

        const body = await req.json();

        const message = body.message;
        const sessionId = body.session_id ?? null;

        if (!message || typeof message !== "string") {
          return new Response(
            JSON.stringify({
              error: "Message is required",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        // --------------------------------------------------
        // 3. Получаем профиль пользователя
        // --------------------------------------------------

        const { data: profile, error: profileError } =
          await ctx.supabase
            .from("profiles")
            .select(
              "country, city, language_level, family_status, main_concerns"
            )
            .eq("user_id", userId)
            .maybeSingle();

        if (profileError) {
          console.error("Profile error:", profileError);
        }

        // --------------------------------------------------
        // 4. Создаём или находим сессию
        // --------------------------------------------------

        let currentSessionId = sessionId;

        if (currentSessionId) {
          const { data: session, error: sessionError } =
            await ctx.supabase
              .from("sessions")
              .select("id")
              .eq("id", currentSessionId)
              .eq("user_id", userId)
              .maybeSingle();

          if (sessionError || !session) {
            return new Response(
              JSON.stringify({
                error: "Session not found",
              }),
              {
                status: 404,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              }
            );
          }
        } else {
          const { data: newSession, error: sessionError } =
            await ctx.supabase
              .from("sessions")
              .insert({
                user_id: userId,
                title: "Новый разговор",
              })
              .select("id")
              .single();

          if (sessionError) {
            console.error("Session creation error:", sessionError);

            return new Response(
              JSON.stringify({
                error: "Could not create session",
                details: sessionError.message,
              }),
              {
                status: 500,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json",
                },
              }
            );
          }

          currentSessionId = newSession.id;
        }

        // --------------------------------------------------
        // 5. Сохраняем сообщение пользователя
        // --------------------------------------------------

        const { error: userMessageError } =
          await ctx.supabase
            .from("messages")
            .insert({
              session_id: currentSessionId,
              user_id: userId,
              role: "user",
              content: message,
            });

        if (userMessageError) {
          console.error(
            "User message error:",
            userMessageError
          );
        }

        // --------------------------------------------------
        // 6. Получаем историю разговора
        // --------------------------------------------------

        const { data: history, error: historyError } =
          await ctx.supabase
            .from("messages")
            .select("role, content")
            .eq("session_id", currentSessionId)
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
            .limit(20);

        if (historyError) {
          console.error(
            "History error:",
            historyError
          );
        }

        // --------------------------------------------------
        // 7. Системная инструкция BETWEEN
        // --------------------------------------------------

        const systemPrompt = `
Ты — AI-помощник по психологической поддержке приложения BETWEEN.

Твоя задача — помогать людям, которые проходят через переезд,
эмиграцию и адаптацию к новой стране.

Ты не являешься врачом или лицензированным психотерапевтом.
Не ставь диагнозы и не утверждай, что у человека есть
конкретное психическое расстройство.

Твой стиль:
- тепло
- спокойно
- естественно
- без осуждения
- без канцелярита
- без шаблонных советов
- не перегружай человека информацией
- обычно задавай только один хороший вопрос

Сначала постарайся понять эмоциональное состояние человека.

Хорошая структура ответа:
1. Покажи, что ты понял его состояние.
2. Помоги немного разобраться в происходящем.
3. Если уместно — задай один уточняющий вопрос.

Не выдавай длинные списки из пяти или десяти советов,
если человек их не просил.

Если человек сообщает о непосредственной опасности для себя
или других, суицидальных намерениях или другом кризисном
состоянии, не пытайся заменить экстренную или профессиональную
помощь. Рекомендуй обратиться к человеку рядом,
профессионалу или местной экстренной службе.

Информация о пользователе:

Страна: ${profile?.country ?? "не указана"}
Город: ${profile?.city ?? "не указан"}
Уровень языка: ${profile?.language_level ?? "не указан"}
Семейный статус: ${profile?.family_status ?? "не указан"}
Основные трудности: ${
          Array.isArray(profile?.main_concerns)
            ? profile.main_concerns.join(", ")
            : "не указаны"
        }

Ты разговариваешь с человеком, а не заполняешь анкету.
`;

        // --------------------------------------------------
        // 8. OpenRouter
        // --------------------------------------------------

        const openRouterKey =
          Deno.env.get("OPENROUTER_API_KEY");

        if (!openRouterKey) {
          throw new Error(
            "OPENROUTER_API_KEY is not configured"
          );
        }

        const aiResponse = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openRouterKey}`,
              "Content-Type": "application/json",
              "X-Title": "BETWEEN AI Psychologist",
            },
            body: JSON.stringify({
              model: "openai/gpt-chat-latest",
              max_tokens: 500,
              messages: [
                {
                  role: "system",
                  content: systemPrompt,
                },
                ...(history ?? []),
              ],
            }),
          }
        );

        const aiData = await aiResponse.json();

        if (!aiResponse.ok) {
          console.error("OpenRouter error:", aiData);

          return new Response(
            JSON.stringify({
              error: "AI provider error",
              details: aiData,
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            }
          );
        }

        const answer =
          aiData?.choices?.[0]?.message?.content ??
          "Не удалось получить ответ.";

        // --------------------------------------------------
        // 9. Сохраняем ответ AI
        // --------------------------------------------------

        const { error: assistantMessageError } =
          await ctx.supabase
            .from("messages")
            .insert({
              session_id: currentSessionId,
              user_id: userId,
              role: "assistant",
              content: answer,
            });

        if (assistantMessageError) {
          console.error(
            "Assistant message error:",
            assistantMessageError
          );
        }

        // --------------------------------------------------
        // 10. Возвращаем ответ приложению
        // --------------------------------------------------

        return new Response(
          JSON.stringify({
            answer,
            session_id: currentSessionId,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        console.error("Function error:", error);

        return new Response(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Unknown error",
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }
  ),
};
