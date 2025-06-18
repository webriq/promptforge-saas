import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

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
      throw new Error("Invalid token");
    }

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .select("*")
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

    if (req.method === "POST") {
      const { title } = await req.json();

      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .insert({
          title: title || "New Chat",
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
