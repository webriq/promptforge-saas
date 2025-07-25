import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { getAuthors, getBlogs, getCategories } from "../_shared/rag-utils.ts";

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
    const { action } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter 'action'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let data;

    if (action === "get_authors") {
      data = await getAuthors();
    } else if (action === "get_categories") {
      data = await getCategories();
    } else if (action === "get_blogs") {
      data = await getBlogs();
    } else {
      return new Response(
        JSON.stringify({
          error:
            "Invalid action. Valid actions: get_authors, get_categories, get_blogs",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Schemas API Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
