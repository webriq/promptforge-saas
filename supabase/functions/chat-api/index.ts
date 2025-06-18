import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      throw new Error("Unauthorized request");
    }

    const { messages, projectId, sessionId } = await req.json();

    if (!projectId) {
      return new Response("Missing required fields", {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const projectId = url.searchParams.get("project_id");
      const sessionId = url.searchParams.get("session_id");

      let query = supabase.from("chat_messages").select("*").eq(
        "project_id",
        projectId,
      );

      if (projectId) query = query.eq("project_id", projectId);
      if (sessionId) query = query.eq("session_id", sessionId);

      const { data, error } = await query.order("created_at", {
        ascending: true,
      });

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const { data, error } = await supabase
        .from("chat_messages")
        .upsert(
          {
            messages,
            project_id: projectId,
            session_id: sessionId,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "session_id",
          },
        )
        .select();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
