import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { storeKnowledgeBase } from "../_shared/rag-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Simple sentence-based chunking
const chunkContent = (text: string): string[] => {
  return text
    .replace(/([.?!])\s*(?=[A-Z])/g, "$1|")
    .split("|")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 10); // Only keep chunks with more than 10 chars
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { sessionId, content, fileName, fileType } = await req.json();

    if (!sessionId || !content) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunk the content
    const chunks = chunkContent(content);

    // Store each chunk in the knowledge base
    const metadata = { fileName, fileType };
    await Promise.all(
      chunks.map((chunk) => storeKnowledgeBase(sessionId, chunk, metadata)),
    );

    return new Response(
      JSON.stringify({ success: true, chunks: chunks.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
