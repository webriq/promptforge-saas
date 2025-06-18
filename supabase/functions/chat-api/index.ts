import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { buildRAGContext } from "../_shared/rag-utils.ts";
import { openaiClient } from "../_shared/openai-client.ts";

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

    const { messages, sessionId } = await req.json();
    if (!sessionId) {
      return new Response(
        JSON.stringify("Session ID is required"),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage.content;

    // Build RAG context
    const ragContext = await buildRAGContext(sessionId, userQuery);

    // Create system prompt with context
    const systemPrompt =
      `You are a helpful AI assistant with access to relevant context from previous conversations and uploaded documents.
Context from knowledge base:
${ragContext.relevantKnowledge.map((kb) => `- ${kb.content}`).join("\n")}

Recent chat history:
${ragContext.chatHistory.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}

Use this context to provide accurate and relevant responses. If the user asks about something not in the context, let them know you can help them upload relevant documents or provide more information.

Primary actions you can suggest:
1. Chat about topics in your knowledge base
2. Upload files to expand your knowledge base
3. Summarize uploaded content
4. Generate new content based on your knowledge base
5. Enhance content based on your knowledge base

TONE: Professional, conversational, and helpful — never robotic or overly verbose.

CRITICAL BEHAVIOR RULES:
- ALWAYS ask at least one question in each response
- ALWAYS suggest one specific asset or action
- Use short paragraphs with natural breaks
- Use plain text formatting (no markdown)
- If uncertain, admit it briefly and ask a clarifying question
- When suggesting a resource, always format the link if the URL is not null or empty. Format any valid links as: <a href="URL" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">link text</a>
- NEVER ask the user for their name or email or personal information under any circumstances
- If the user requests to speak with a representative or human, DO NOT ask for contact information. 
  Just acknowledge their request and inform them that a team member from WebriQ will reach out using the same email login in StackShift.
`;

    // Store user message
    await supabaseAdmin.from("chat_messages").insert({
      session_id: sessionId,
      role: "user",
      content: userQuery,
    });

    // Prepare messages for OpenAI
    const openaiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.slice(-5).map((msg: any) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    ];

    // Create a readable stream for the response
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = "";

        try {
          for await (
            const chunk of openaiClient.streamChatCompletion(
              openaiMessages,
            )
          ) {
            fullResponse += chunk;

            // Send the chunk to the client
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
            );
          }

          // Store assistant response
          await supabaseAdmin.from("chat_messages").insert({
            session_id: sessionId,
            role: "assistant",
            content: fullResponse,
          });

          // Send completion signal
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(
      JSON.stringify({ stream }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error processing request: ", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: errorMessage,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
