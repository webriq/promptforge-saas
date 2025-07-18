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
    const { action, projectId, sessionId, title = "New Chat" } = await req
      .json();
    if (!action || !projectId) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameters 'action' or 'projectId'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action !== "create" && action !== "retrieve" && action !== "update") {
      return new Response(
        JSON.stringify({
          error: "Invalid action. Should be 'create', 'retrieve', or 'update'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let data;
    if (action === "create") {
      // Create new session
      const { data: newSession, error: createSessionError } =
        await supabaseClient
          .from("chat_sessions")
          .insert({ project_id: projectId, title })
          .select()
          .single();

      if (createSessionError) {
        throw new Error("Failed to create session: ", createSessionError);
      }

      data = newSession;
    }

    if (action === "update") {
      // Update existing session
      if (!sessionId) {
        return new Response(
          JSON.stringify({
            error: "sessionId is required for 'update' action",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: updatedSession, error: updateSessionError } =
        await supabaseClient
          .from("chat_sessions")
          .update({ title })
          .eq("id", sessionId)
          .eq("project_id", projectId) // Ensure we only update sessions for this project
          .select()
          .single();

      if (updateSessionError) {
        throw new Error("Failed to update session: ", updateSessionError);
      }

      data = updatedSession;
    }

    if (action === "retrieve") {
      const { data: chatSessions, error: retrieveSessionsError } =
        await supabaseClient
          .from("chat_sessions")
          .select("id, project_id, title, created_at, updated_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });

      if (retrieveSessionsError) {
        throw new Error("Failed to retrieve sessions: ", retrieveSessionsError);
      }

      data = chatSessions;
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
