import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { buildRAGContext } from "../_shared/rag-utils.ts";
import { openaiClient } from "../_shared/openai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { action, sessionId, message } = await req.json();
    if (!action || !sessionId || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    let messages;

    if (action === "retrieve") {
      const { data: messagesArray, error } = await supabaseAdmin
        .from("chat_messages")
        .select("messages")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error("Failed to retrieve messages");
      }

      messages = messagesArray || [];
    }

    if (action === "add") {
      const { data, error: fetchError } = await supabaseAdmin
        .from("chat_messages")
        .select("messages")
        .eq("session_id", sessionId)
        .single();

      if (fetchError) throw fetchError;

      const currentMessages = data?.messages || [];

      // Store user message
      const userMessage = {
        sender: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      const initialMessages = [...currentMessages, userMessage];
      const { error: userMsgError } = await supabaseAdmin.from("chat_messages")
        .insert({
          session_id: sessionId,
          messages: initialMessages,
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
      const knowledgeContext = ragContext.relevantKnowledge.map((k) =>
        k.content
      )
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

      // append response to messages
      const newMessage = {
        sender: "assistant",
        content: assistantText,
        timestamp: new Date().toISOString(),
      };
      const updatedMessages = [...currentMessages, newMessage];

      const { error: assistantMsgError } = await supabaseAdmin
        .from("chat_messages")
        .update({ messages: updatedMessages })
        .eq("session_id", sessionId)
        .select();
      if (assistantMsgError) throw assistantMsgError;

      messages = updatedMessages;
    }

    return new Response(JSON.stringify(messages), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
