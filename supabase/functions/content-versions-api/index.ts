import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  getContentVersion,
  getContentVersions,
  getLatestContentVersion,
} from "../_shared/rag-utils.ts";

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
    const { action, sessionId, versionId } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter 'action'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let data;

    switch (action) {
      case "list":
        if (!sessionId) {
          return new Response(
            JSON.stringify({
              error: "sessionId is required for 'list' action",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        data = await getContentVersions(sessionId);
        break;

      case "get":
        if (!versionId) {
          return new Response(
            JSON.stringify({ error: "versionId is required for 'get' action" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        data = await getContentVersion(versionId);
        break;

      case "latest":
        if (!sessionId) {
          return new Response(
            JSON.stringify({
              error: "sessionId is required for 'latest' action",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        data = await getLatestContentVersion(sessionId);
        break;

      default:
        return new Response(
          JSON.stringify({
            error: "Invalid action. Valid actions: list, get, latest",
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
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
