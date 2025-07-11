import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { chunkContent, storeBulkKnowledgeBase } from "../_shared/rag-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ContentItem {
  content: string;
  source: string;
  metadata?: Record<string, any>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { projectId, sessionId, contentItems } = await req.json();

    if (
      !projectId || !sessionId || !contentItems || !Array.isArray(contentItems)
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required parameters: projectId, sessionId, and contentItems array",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[Bulk Knowledge API] Processing ${contentItems.length} items for project: ${projectId}`,
    );

    // Process and chunk all content items
    const processedItems: Array<{
      content: string;
      source: string;
      metadata?: Record<string, any>;
    }> = [];

    for (const item of contentItems) {
      if (!item.content || !item.source) {
        console.warn("Skipping item with missing content or source");
        continue;
      }

      // Chunk the content for better embedding storage
      const chunks = chunkContent(item.content, 800, 100);

      // Add each chunk as a separate item
      for (const chunk of chunks) {
        processedItems.push({
          content: chunk,
          source: item.source,
          metadata: {
            ...item.metadata,
            chunk_index: chunks.indexOf(chunk),
            total_chunks: chunks.length,
          },
        });
      }
    }

    if (processedItems.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No valid content items to process",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[Bulk Knowledge API] Created ${processedItems.length} chunks from ${contentItems.length} items`,
    );

    // Store all processed items in the knowledge base
    await storeBulkKnowledgeBase(projectId, sessionId, processedItems);

    return new Response(
      JSON.stringify({
        success: true,
        stored: processedItems.length,
        sources: contentItems.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Bulk Knowledge API] Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
