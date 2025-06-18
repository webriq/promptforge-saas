import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { storeKnowledgeBase } from "../_shared/rag-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Process request
    const { sessionId, file } = await req.json();
    if (!sessionId || !file) {
      throw new Error("Missing required parameters");
    }

    // Assume file.content is plain text (already extracted on frontend or via a separate endpoint)
    // Split into chunks (e.g., by paragraphs or every 1000 chars)
    const chunkSize = 1000;
    const text = file.content;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      await storeKnowledgeBase(sessionId, chunk, {
        filename: file.name,
        fileType: file.type,
        uploadedAt: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
