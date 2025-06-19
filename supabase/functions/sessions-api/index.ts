import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
    const { action, projectId, title = "New Chat" } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let data;
    if (action === "create") {
      // Create new session
      const { data: newSession, error } = await supabaseClient
        .from("chat_sessions")
        .insert({ project_id: projectId, title })
        .select()
        .single();

      if (error) {
        throw new Error("Failed to create session");
      }

      data = newSession;
    }

    if (action === "retrieve") {
      const { data: chatSessions, error } = await supabaseClient
        .from("chat_sessions")
        .select()
        .eq("project_id", projectId)
        .single();

      if (error) {
        throw new Error("Failed to retrieve session");
      }

      data = chatSessions;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
