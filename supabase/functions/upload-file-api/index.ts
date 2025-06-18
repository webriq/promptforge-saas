import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { storeKnowledgeBase } from "../_shared/rag-utils.ts";

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

    // Process request
    const { sessionId, file, chunk } = await req.json();

    if (!sessionId || !file || !chunk) {
      throw new Error("Missing required parameters");
    }

    await storeKnowledgeBase(sessionId, chunk, {
      filename: file.name,
      fileType: file.type,
      uploadedAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
