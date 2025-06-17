import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Missing auth token");
    }
    const token = authHeader.split(" ")[1];
    if (token !== Deno.env.get("SERVICE_AUTH_TOKEN")) {
      throw new Error("Invalid token");
    }

    const { action, messages, userId, sessionId, projectId } = await req.json();

    // Initialize services
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!action) {
      throw new Error("Missing required action");
    }

    if (action !== "save" && action !== "retrieve") {
      throw new Error("Action is neither 'save' nor 'retrieve'");
    }

    // Save chat history
    if (action === "save") {
      const { data, error } = await supabase
        .from("chat_history")
        .insert({
          messages: JSON.stringify(messages),
          user_info: userId,
          session_id: sessionId,
          project_id: projectId,
        })
        .select("id")
        .single();

      if (error) {
        throw new Error("Failed to save chat history", error);
      }

      return new Response(
        JSON.stringify({ success: true, history_id: data.id }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "retrieve") {
      const { data, error } = await supabase
        .from("chat_history")
        .select(`
          id,
          created_at,
          messages,
          chat_summary(content, metadata)
        `)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error("Failed to retrieve chat history", error);
      }

      return new Response(
        JSON.stringify(data),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
});
