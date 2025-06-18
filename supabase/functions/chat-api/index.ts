import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { buildRAGContext } from "../_shared/rag-utils.ts";
import { openaiClient } from "../_shared/openai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const { sessionId, message } = await req.json();
    if (!sessionId || !message) {
      return new Response(
        JSON.stringify({ error: "Missing sessionId or message" }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    // Store user message
    const { error: userMsgError } = await supabaseAdmin.from("chat_messages")
      .insert({
        session_id: sessionId,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      });
    if (userMsgError) throw userMsgError;

    // Build RAG context (last 10 messages + relevant knowledge)
    const ragContext = await buildRAGContext(sessionId, message);
    const chatHistory = ragContext.chatHistory.map(
      (msg): import("../_shared/types.ts").OpenAIMessage => {
        let role: "user" | "assistant" = "user";
        if (msg.role === "assistant") role = "assistant";
        return {
          role,
          content: msg.content,
        };
      },
    );
    const knowledgeContext = ragContext.relevantKnowledge.map((k) => k.content)
      .join("\n---\n");

    // Compose system prompt
    const systemPrompt = knowledgeContext
      ? `You are a helpful assistant. Use the following context to answer the user's question.\n\nContext:\n${knowledgeContext}\n\nIf the context doesn't contain relevant information, say so politely and ask for more specific information or suggest uploading relevant documents.`
      : `You are a helpful assistant. The user hasn't provided any context or knowledge base content yet. Please ask them to upload documents or provide information that you can help them with.`;

    const openaiMessages: import("../_shared/types.ts").OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: message },
    ];

    // Get assistant response from OpenAI
    const completionRes = await openaiClient.createChatCompletion(
      openaiMessages,
    );
    const completionData = await completionRes.json();
    const assistantText = completionData.choices?.[0]?.message?.content || "";

    // Store assistant message
    const { error: assistantMsgError } = await supabaseAdmin.from(
      "chat_messages",
    ).insert({
      session_id: sessionId,
      role: "assistant",
      content: assistantText,
      created_at: new Date().toISOString(),
    });
    if (assistantMsgError) throw assistantMsgError;

    return new Response(JSON.stringify({ text: assistantText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
