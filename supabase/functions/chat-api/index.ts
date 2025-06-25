import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import { buildRAGContext } from "../_shared/rag-utils.ts";
import type { OpenAIMessage } from "../_shared/types.ts";

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
    const { projectId, sessionId, messages } = await req.json();
    if (
      !projectId ||
      !sessionId ||
      !messages ||
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing or invalid parameters: projectId, sessionId and messages are required.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userMessage = messages[messages.length - 1];

    // Create a more specific search query by including file names
    const fileNames = userMessage.attachments?.map((a: any) =>
      a.fileName
    ).join(" ") || "";
    const searchQuery = userMessage.content + " " + fileNames;

    // Store user message
    const { error: insertError } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role: userMessage.role,
        content: userMessage.content,
        attachments: userMessage.attachments || null,
      });

    if (insertError) {
      throw new Error(`Failed to store user message: ${insertError.message}`);
    }

    const { relevantKnowledge, chatHistory } = await buildRAGContext(
      projectId,
      sessionId,
      searchQuery,
    );

    console.log("Search query:", searchQuery);
    console.log("Project ID:", projectId);
    console.log("Found knowledge entries:", relevantKnowledge?.length || 0);

    const context = relevantKnowledge?.map((k) => k.content).join("\n\n") || "";

    console.log("Context length:", context.length);

    const systemPrompt =
      `You are a helpful AI assistant for our company dedicated to generating AI-ready content. Get information from the "Knowledge base" to answer questions.
      
      ROLE AND PURPOSE: Assist users in generating content guided by LLM-readiness best practices using the provided context.
      
      TONE: Professional, conversational, and helpful — never robotic or overly verbose.

      RESPONSE STRUCTURE:
      - If you have relevant information from the Knowledge base to generate content, format your response as follows:
        1. Start with a brief conversational summary of what you're generating
        2. Then include the generated content within \`====\` delimiters
        3. The generated content should be properly formatted markdown
      
      - If you don't have enough relevant information in the Knowledge base:
        1. Respond conversationally explaining that you need more context
        2. Suggest uploading relevant documents
        3. DO NOT include the \`====\` delimiters or generate placeholder content
      
      CONTENT FORMATTING (for content inside the \`====\` delimiters):
      - Must be valid markdown
      - Include a title as level-1 heading (e.g., # Title)
      - If generating blog posts, include author line: *Author: [Name]*
      - Structure content with proper headings, paragraphs, and formatting
      
      CRITICAL BEHAVIOR RULES:
      - ONLY generate content if you have relevant information from the Knowledge base
      - When files are uploaded, their content appears in the Knowledge base
      - Never generate generic content without specific context
      - Do not create fictional or placeholder information
      - If unsure, ask for clarification rather than generating content
      
      Knowledge base context:
      ${context}
      
      ${
        context.trim() === ""
          ? "IMPORTANT: No knowledge base content found for this project. This means no files have been uploaded yet, or the uploaded content doesn't match the query. You MUST inform the user that they need to upload relevant documents (PDF or text files) to get started. Do NOT generate generic content."
          : "Use the above knowledge base content to inform your response. Generate content based on this specific information."
      }
    `;

    const conversation: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: userMessage.role, content: userMessage.content },
    ];

    // Generate AI response
    const response = await openaiClient.createChatCompletion(conversation);
    const aiResponseData = await response.json();
    const aiResponseContent = aiResponseData.choices[0].message.content;

    if (!aiResponseContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    // Store assistant message
    await supabaseAdmin.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: aiResponseContent,
    });

    // Return all messages for the session to update the UI
    const { data: allMessages } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, attachments, created_at")
      .eq("session_id", sessionId)
      .order("created_at");

    return new Response(JSON.stringify({ response: allMessages }), {
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
