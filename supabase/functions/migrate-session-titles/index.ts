import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Function to generate a concise title for the chat session
async function generateSessionTitle(
  userMessage: string,
  aiResponse: string,
): Promise<string> {
  try {
    const titlePrompt =
      `Based on the following conversation, create a concise, descriptive title (max 6 words) that captures the main topic or purpose of the chat:

User: ${userMessage.substring(0, 200)}...
AI: ${aiResponse.substring(0, 200)}...

Requirements:
- Maximum 6 words
- Descriptive and clear
- No quotes or special characters
- Capitalize appropriately

Title:`;

    const response = await openaiClient.createChatCompletion([
      {
        role: "system",
        content:
          "You are a helpful assistant that creates concise chat titles. Always respond with just the title, nothing else.",
      },
      { role: "user", content: titlePrompt },
    ]);

    const titleData = await response.json();
    const generatedTitle = titleData.choices[0].message.content?.trim();

    if (generatedTitle && generatedTitle.length > 0) {
      // Clean up the title and ensure it's not too long
      const cleanTitle = generatedTitle.replace(/['"]/g, "").trim();
      return cleanTitle.length > 50
        ? cleanTitle.substring(0, 50) + "..."
        : cleanTitle;
    }

    return "New Chat";
  } catch (error) {
    console.error("Failed to generate session title:", error);
    return "New Chat";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { projectId, dryRun = false } = await req.json();

    if (!projectId) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter 'projectId'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Starting migration for project: ${projectId}${
        dryRun ? " (DRY RUN)" : ""
      }`,
    );

    // Find all sessions with "New Chat" title
    const { data: sessionsToMigrate, error: sessionsError } =
      await supabaseAdmin
        .from("chat_sessions")
        .select("id, title")
        .eq("project_id", projectId)
        .eq("title", "New Chat");

    if (sessionsError) {
      throw new Error(`Failed to fetch sessions: ${sessionsError.message}`);
    }

    if (!sessionsToMigrate || sessionsToMigrate.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No sessions found with 'New Chat' title",
          migratedCount: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(`Found ${sessionsToMigrate.length} sessions to migrate`);

    const migrationResults = [];
    let successCount = 0;
    let errorCount = 0;

    for (const session of sessionsToMigrate) {
      try {
        console.log(`Processing session: ${session.id}`);

        // Get the first user message and first AI response for this session
        const { data: messages, error: messagesError } = await supabaseAdmin
          .from("chat_messages")
          .select("role, content, created_at")
          .eq("session_id", session.id)
          .order("created_at", { ascending: true })
          .limit(10); // Get first 10 messages to find the first user/AI pair

        if (messagesError) {
          throw new Error(
            `Failed to fetch messages for session ${session.id}: ${messagesError.message}`,
          );
        }

        if (!messages || messages.length === 0) {
          console.log(`No messages found for session ${session.id}, skipping`);
          migrationResults.push({
            sessionId: session.id,
            status: "skipped",
            reason: "No messages found",
          });
          continue;
        }

        // Find the first user message and first AI response
        const firstUserMessage = messages.find((m) => m.role === "user");
        const firstAIMessage = messages.find((m) => m.role === "assistant");

        if (!firstUserMessage || !firstAIMessage) {
          console.log(
            `Session ${session.id} doesn't have both user and AI messages, skipping`,
          );
          migrationResults.push({
            sessionId: session.id,
            status: "skipped",
            reason: "Missing user or AI message",
          });
          continue;
        }

        // Generate new title
        const newTitle = await generateSessionTitle(
          firstUserMessage.content,
          firstAIMessage.content,
        );

        if (newTitle === "New Chat") {
          console.log(
            `Could not generate title for session ${session.id}, skipping`,
          );
          migrationResults.push({
            sessionId: session.id,
            status: "skipped",
            reason: "Title generation failed",
          });
          continue;
        }

        console.log(`Generated title for session ${session.id}: "${newTitle}"`);

        // Update the session title (only if not dry run)
        if (!dryRun) {
          const { error: updateError } = await supabaseAdmin
            .from("chat_sessions")
            .update({ title: newTitle })
            .eq("id", session.id);

          if (updateError) {
            throw new Error(
              `Failed to update session ${session.id}: ${updateError.message}`,
            );
          }
        }

        migrationResults.push({
          sessionId: session.id,
          status: "success",
          oldTitle: session.title,
          newTitle: newTitle,
        });

        successCount++;
        console.log(
          `Successfully ${
            dryRun ? "would migrate" : "migrated"
          } session ${session.id}`,
        );
      } catch (error) {
        console.error(`Error processing session ${session.id}:`, error);
        migrationResults.push({
          sessionId: session.id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        errorCount++;
      }

      // Add a small delay to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const summary = {
      totalSessions: sessionsToMigrate.length,
      successCount,
      errorCount,
      skippedCount: sessionsToMigrate.length - successCount - errorCount,
      dryRun,
      results: migrationResults,
    };

    console.log(
      `Migration completed: ${successCount} success, ${errorCount} errors, ${summary.skippedCount} skipped`,
    );

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Migration error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
