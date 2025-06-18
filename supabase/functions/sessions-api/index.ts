import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, projectId, title } = body;

    if (!action || (action !== "create" && action !== "retrieve")) {
      throw new Error("Missing required action: 'create' or 'retrieve'");
    }

    if (action === "retrieve") {
      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Failed to retrieve sessions: ", error);
        throw new Error("Failed to retrieve sessions");
      }

      return new Response(
        JSON.stringify(data),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "create") {
      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .insert({
          title: title || "New Chat",
          project_id: projectId,
        })
        .select()
        .single();

      if (error) {
        console.error("Failed to add new chat session: ", error);
        throw new Error("Failed to add new chat session");
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
    console.error("Error processing request: ", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: errorMessage,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  return new Response("Method Not Allowed", {
    status: 405,
    headers: corsHeaders,
  });
});
