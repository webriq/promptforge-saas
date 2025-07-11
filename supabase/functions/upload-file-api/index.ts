import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { chunkContent, storeKnowledgeBase } from "../_shared/rag-utils.ts";

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
    const { projectId, sessionId, content, fileName, fileType } = await req
      .json();

    if (!projectId || !sessionId || !content || !fileName) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chunk the content for better embedding storage
    const chunks = chunkContent(content);

    // Store each chunk in the knowledge base with fileName as source
    const metadata = { fileName, fileType };

    console.log("Storing chunks for project:", projectId);
    console.log("Session:", sessionId);
    console.log("Chunks to store:", chunks.length);
    console.log("Source file:", fileName);

    await Promise.all(
      chunks.map((chunk) =>
        storeKnowledgeBase(projectId, sessionId, chunk, fileName, metadata)
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
