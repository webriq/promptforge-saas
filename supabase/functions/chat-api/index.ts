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
    const { sessionId, messages } = await req.json();
    if (
      !sessionId ||
      !messages ||
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing or invalid parameters: sessionId and messages are required.",
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
      sessionId,
      searchQuery,
    );
    const context = relevantKnowledge?.map((k) => k.content).join("\n\n") || "";

    const systemPrompt =
      `You are a helpful AI assistant for our company dedicated to generating AI-ready content. Get information from the "Knowledge base" to answer questions.
      If no relevant info is found, say so politely and ask for more context or suggest uploading documents.
            
      ROLE AND PURPOSE: Assist users in generating content guided by LLM-readiness best practices using the provided context.
      
      TONE: Professional, conversational, and helpful — never robotic or overly verbose.

      RESPONSE STRUCTURE:
      - Briefly acknowledge the user's question by stating you are ready to assist (1-2 sentences max)
      - If context is provided, always start response with: 'Here's the AI-generated content: '
      - Provide the output in format:
        ====
        Author: {AUTHOR} if provided else skip
        {CONTENT}
        ====
      - For the {CONTENT} part, you must use markdown formatting with related styling (e.g. title by headings, bold, italic, etc.)
      - If user asks for a summary, provide a brief summary of the content
      - If user asks for enhancement or review on content, provide a summary and list of needed changes (if any)
      - If user asks to include external sources, provide a list of sources and their URLs at the end of the response
      - If user asks out-of-scope actions, politely decline specifying your role and suggest in-scope actions to generate AI-ready content
      
      CRITICAL BEHAVIOR RULES:
      - When a file is attached, its content is in the "Knowledge base". Use it to answer the user's question.
      - Do not generate content that is offensive, inappropriate, spam or irrelevant to the context
      - Never perform external search or suggest out-of-scope content. Strictly get info from the "Knowledge base".
      - Do not repeat the same content multiple times
      - Do not ask out-of-scope questions
      
      Knowledge base:
      ${context}
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
