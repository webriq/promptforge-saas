import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { OpenAI } from "https://esm.sh/openai@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { sessionId, messages } = await req.json();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Save user message
    await supabaseClient
      .from("chat_messages")
      .insert({ session_id: sessionId, messages });

    // Retrieve relevant knowledge
    const { data: knowledge } = await supabaseClient
      .from("knowledge_base")
      .select("content")
      .eq("session_id", sessionId);

    const context = knowledge?.map((k) => k.content).join("\n\n") || "";

    // Get chat history
    const { data: history } = await supabaseClient
      .from("chat_messages")
      .select("messages")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    // Generate AI response
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `You are a helpful AI assistant for our company. Your task is to generate AI-ready content based on the provided context and user's question.
            If the context doesn't contain relevant information, say so politely and ask for more specific information or suggest uploading relevant documents.
            Context:\n${context}
          `,
        },
        ...(history || []).map((h) => ({ role: h.role, content: h.content })),
        ...messages,
      ],
      temperature: 0.95,
    });

    const aiResponse = completion.choices[0].message.content;

    const messagesWithAIResponse = [
      ...history,
      {
        role: "assistant",
        content: aiResponse,
      },
    ];

    // Save AI response
    await supabaseClient
      .from("chat_messages")
      .insert({ session_id: sessionId, messages: messagesWithAIResponse });

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
