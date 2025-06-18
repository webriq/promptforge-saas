import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight request
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
    const body = await req.json();
    const { action, projectId, title } = body;

    if (!action || (action !== "create" && action !== "retrieve")) {
      throw new Error("Missing required action: 'create' or 'retrieve'");
    }

    let sessionsData;
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
      sessionsData = data;
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

      sessionsData = data;
    }

    return new Response(
      JSON.stringify(sessionsData),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
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
});
