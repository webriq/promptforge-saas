import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  chunkContent,
  cleanupGeneratedContentFromKnowledgeBase,
  storeBulkKnowledgeBase,
} from "../_shared/rag-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const requestData = await req.json();
    const { action, projectId, sessionId, contentItems } = requestData;

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter 'action'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter 'projectId'" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let data;

    switch (action) {
      case "store_bulk":
        if (!sessionId || !contentItems) {
          return new Response(
            JSON.stringify({
              error:
                "sessionId and contentItems are required for 'store_bulk' action",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Process and chunk content items
        const processedItems = contentItems.flatMap((item: any) => {
          if (item.content && item.content.length > 1000) {
            const chunks = chunkContent(item.content, 1000, 100);
            return chunks.map((chunk, index) => ({
              content: chunk,
              source: item.source || "user_upload",
              metadata: {
                ...item.metadata,
                chunk_index: index,
                total_chunks: chunks.length,
              },
            }));
          }
          return [item];
        });

        await storeBulkKnowledgeBase(
          projectId,
          sessionId,
          processedItems,
        );

        data = {
          success: true,
          message:
            `Successfully stored ${processedItems.length} items to knowledge base`,
          items_processed: processedItems.length,
        };
        break;

      case "cleanup_generated_content":
        // New action to cleanup old generated_content entries
        console.log(
          `[Bulk Knowledge API] Cleaning up generated_content for project: ${projectId}`,
        );

        const cleanupResult = await cleanupGeneratedContentFromKnowledgeBase(
          projectId,
        );

        data = {
          success: cleanupResult.success,
          message: cleanupResult.success
            ? `Successfully cleaned up ${cleanupResult.deletedCount} generated_content entries`
            : "Failed to cleanup generated_content entries",
          deleted_count: cleanupResult.deletedCount,
        };
        break;

      default:
        return new Response(
          JSON.stringify({
            error:
              "Invalid action. Valid actions: store_bulk, cleanup_generated_content",
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
    console.error("[Bulk Knowledge API] Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
