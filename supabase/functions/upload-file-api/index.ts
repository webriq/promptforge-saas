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
    const { projectId, sessionId, content, fileName, fileType } = await req
      .json();

    if (!projectId || !sessionId || !content) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunk the content
    const chunks = chunkContent(content);

    // Store each chunk in the knowledge base
    const metadata = { fileName, fileType };

    console.log("Storing chunks for project:", projectId);
    console.log("Session:", sessionId);
    console.log("Chunks to store:", chunks.length);

    await Promise.all(
      chunks.map((chunk) =>
        storeKnowledgeBase(projectId, sessionId, chunk, metadata)
      ),
    );

    console.log("Successfully stored all chunks in knowledge base");

    return new Response(
      JSON.stringify({ success: true, chunks: chunks.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
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
