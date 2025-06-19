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
    const { sessionId, message } = await req.json();
    if (!sessionId || !message) {
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
      .insert({ session_id: sessionId, role: "user", content: message });

    // Retrieve relevant knowledge
    const { data: knowledge } = await supabaseClient
      .from("knowledge_base")
      .select("content")
      .eq("session_id", sessionId);

    const context = knowledge?.map((k) => k.content).join("\n\n") || "";

    // Get chat history
    const { data: history } = await supabaseClient
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    // Generate AI response
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant. Use this context: ${context}`,
        },
        ...(history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ],
    });

    const aiResponse = completion.choices[0].message.content;

    // Save AI response
    await supabaseClient
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role: "assistant",
        content: aiResponse,
      });

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
