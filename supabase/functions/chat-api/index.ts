import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import {
  buildRAGContext,
  getAuthors,
  getBlogs,
  getCategories,
  storeContentVersion,
} from "../_shared/rag-utils.ts";
import type { ChatMessage, OpenAIMessage } from "../_shared/types.ts";
import { tools } from "../_shared/openai-fn-tools.ts";

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

// Function to update session title
async function updateSessionTitle(
  sessionId: string,
  projectId: string,
  title: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("chat_sessions")
      .update({ title })
      .eq("id", sessionId)
      .eq("project_id", projectId);

    if (error) {
      console.error("Failed to update session title:", error);
    } else {
      console.log(`Updated session ${sessionId} title to: ${title}`);
    }
  } catch (error) {
    console.error("Error updating session title:", error);
  }
}

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

    // Create search query from user message content
    const searchQuery = userMessage.content;

    // Store user message (no attachments in new workflow)
    const { error: insertError } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role: userMessage.role,
        content: userMessage.content,
      });

    if (insertError) {
      throw new Error(`Failed to store user message: ${insertError.message}`);
    }

    // Check if this is the first message in the session (for title generation)
    const { data: messageCount } = await supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact" })
      .eq("session_id", sessionId);

    const isFirstMessage = messageCount && messageCount.length <= 1;

    // Build RAG context from knowledge base and chat history
    const context = await buildRAGContext(projectId, sessionId, searchQuery);
    const { relevantKnowledge, chatHistory } = context;

    const knowledgeContext = relevantKnowledge?.map((k: any) => {
      let sourceLabel;
      switch (k.source) {
        case "published_content":
          sourceLabel = "[PUBLISHED CONTENT]";
          break;
        case "web_scraping":
          sourceLabel = "[WEB CONTENT]";
          break;
        case "user_upload":
          sourceLabel = "[UPLOADED DOCUMENT]";
          break;
        default:
          sourceLabel = `[${k.source.toUpperCase()}]`;
      }
      return `${sourceLabel} ${k.content}`;
    }).join("\n\n") || "";

    const fullContext = [knowledgeContext].filter(Boolean).join(
      "\n\n---\n\n",
    );

    const systemPrompt =
      `You are a helpful AI assistant for our company dedicated to generating AI-ready content. Get information from the "Knowledge base" and "Schema data" to answer questions.
      
      ROLE AND PURPOSE: Assist users in generating content guided by LLM-readiness criteria using the provided context. The generated content should be well-structured, informative, and engaging.
      
      TONE: Professional, conversational, and helpful — never robotic or overly verbose.

      CONTENT GUIDELINES:
      - Generate content that meet high scores on the following criteria:
        1. Content Clarity - messaging effectiveness
        2. Fact Attribution - citations/references
        3. Reading Simplicity - readability metrics

      RESPONSE STRUCTURE:
      - If user asks for a LIST of content (e.g. "list blogs", "show authors", "what categories do we have"):
        1. Respond with a conversational summary followed by a simple bulleted or numbered list
        2. DO NOT use ==== delimiters for lists
        3. Format as regular markdown with bullet points or numbered lists
      
      - If user asks to GENERATE/CREATE/EXPAND/REVISE content (e.g. "write a blog post", "create an article", "expand the current blog post", "make it more detailed"):
        1. ALWAYS start with a warm, conversational acknowledgment (e.g., "Certainly! I'll expand the current blog post to be more detailed..." or "I'd be happy to help you create...")
        2. Briefly explain what you're going to do or how you'll approach the task
        3. Include the generated content within \`====\` delimiters
        4. The content inside delimiters should be properly formatted markdown with title and author
      
      - If you don't have enough relevant information in the Knowledge base:
        1. Respond conversationally explaining that you need more context
        2. Suggest uploading relevant documents to the knowledge base or publishing existing content before starting this chat
        3. DO NOT include the \`====\` delimiters or generate placeholder content
      
      CONTENT FORMATTING (for content inside the \`====\` delimiters - ONLY for content generation):
      - Must be valid markdown
      - Include a title as level-1 heading (e.g., # Title)
      - If generating blog posts, include author line if defined by user: *Author: [Author]*
      - If generating blog posts, include category line with relevant category tags based on the generated content or as defined by the user: *Category: [Category]*
      - Structure content with proper headings, paragraphs, and formatting
      
      CRITICAL BEHAVIOR RULES:
      - MANDATORY: Always start your response with a warm, conversational acknowledgment of the user's request (e.g., "Certainly!", "I'd be happy to help!", "Absolutely!")
      - For content generation/expansion requests, acknowledge what you're going to do and how you'll approach it
      - ONLY use ==== delimiters when generating NEW content (articles, blog posts, etc.)
      - NEVER use ==== delimiters for lists, summaries, or informational responses
      - ONLY generate content if you have relevant information from the Knowledge base
      - The Knowledge base contains published content, uploaded documents, and web-scraped content
      - Content marked as "[PUBLISHED CONTENT]" represents previously published articles/blogs that can be referenced or built upon
      - Content marked as "[UPLOADED DOCUMENT]" represents user-uploaded reference materials
      - Content marked as "[WEB CONTENT]" represents scraped web content for context
      - When asked to expand, modify, or build upon previous content, reference the existing published content from the Knowledge base
      - For content analysis requests, examine ALL available content from the Knowledge base
      - Provide detailed analysis of uploaded documents when requested
      - Never generate generic content without specific context
      - Do not create fictional or placeholder information
      - When expanding content, always build upon the existing published content rather than starting from scratch
      - Pay special attention to content marked as "[PUBLISHED CONTENT]" as it represents previously published work that can be built upon
      - Generated content will be saved as draft versions that can later be published to become part of the knowledge base
      
      Knowledge base context:
      ${fullContext}
      
      ${
        fullContext.trim() === ""
          ? "IMPORTANT: No knowledge base content found for this project. This means no content has been uploaded to the knowledge base yet, and no content has been published. You MUST start with a conversational acknowledgment, then inform the user that they need to upload relevant documents, scrape content, or publish existing draft content to the knowledge base before generating new content. Do NOT generate generic content."
          : "Use the above knowledge base content to inform your response. This includes uploaded documents, published content, web-scraped content, and structured schema data (blog posts, authors, categories). When expanding or modifying content, reference and build upon the existing published content. Remember to always start with a conversational acknowledgment."
      }
    `;

    const conversation: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...chatHistory.map((m: ChatMessage) => ({
        role: m.role,
        content: m.content,
      })),
      { role: userMessage.role, content: userMessage.content },
    ];

    // Generate AI response
    const response = await openaiClient.createChatCompletion(
      conversation,
      false,
      tools,
      "auto",
    );
    const aiResponseData = await response.json();
    const aiResponse = aiResponseData.choices[0].message;

    if (!aiResponse.content && !aiResponse.tool_calls) {
      throw new Error("OpenAI returned an empty response.");
    }

    let assistantMessageContent: string;
    let assistantMessageId: string;

    if (aiResponse.tool_calls) {
      const toolMessages: OpenAIMessage[] = [];
      const toolResults = [];

      for (const toolCall of aiResponse.tool_calls) {
        const functionName = toolCall.function.name;

        let result;
        if (functionName === "get_blogs") {
          result = await getBlogs();
        } else if (functionName === "get_authors") {
          result = await getAuthors();
        } else if (functionName === "get_categories") {
          result = await getCategories();
        }
        toolResults.push(result);

        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: functionName,
          content: JSON.stringify(result),
        });
      }

      const conversationWithTools = [
        ...conversation,
        aiResponse,
        ...toolMessages,
      ];

      const toolResponse = await openaiClient.createChatCompletion(
        conversationWithTools,
      );
      const toolResponseData = await toolResponse.json();
      assistantMessageContent = toolResponseData.choices[0].message.content;
    } else {
      assistantMessageContent = aiResponse.content;
    }

    // Store assistant message
    const { data: assistantMessage, error: assistantError } =
      await supabaseAdmin
        .from("chat_messages")
        .insert({
          session_id: sessionId,
          role: "assistant",
          content: assistantMessageContent,
        })
        .select("id")
        .single();

    if (assistantError) {
      throw new Error(
        `Failed to store assistant message: ${assistantError.message}`,
      );
    }
    assistantMessageId = assistantMessage.id;

    // Generate and update session title if this is the first message
    if (isFirstMessage) {
      try {
        const sessionTitle = await generateSessionTitle(
          userMessage.content,
          assistantMessageContent,
        );
        await updateSessionTitle(sessionId, projectId, sessionTitle);
      } catch (titleError) {
        console.error("Failed to generate/update session title:", titleError);
        // Don't fail the whole request if title generation fails
      }
    }

    // Check if the response contains generated content and create a version
    // Only create versions for actual content generation (with ==== delimiters), not for lists or informational responses
    const hasGeneratedContent = assistantMessageContent.includes("====") &&
      assistantMessageContent.includes("# ") &&
      assistantMessageContent.length > 200;

    if (hasGeneratedContent) {
      try {
        // Parse the generated content to extract title, author, etc.
        const parseContentForVersion = (content: string) => {
          let title = "AI-Generated Content";
          let author = "AI Assistant";
          let cleanContent = content;

          // Extract content within ==== delimiters if present
          const delimiterMatch = content.split("====");
          if (delimiterMatch.length > 1) {
            cleanContent = delimiterMatch[1].trim();
          }

          // Extract title from markdown heading
          const titleMatch = cleanContent.match(/^#\s+(.+)$/m);
          if (titleMatch) {
            title = titleMatch[1];
          }

          // Extract author
          const authorMatch = cleanContent.match(/\*Author:\s*(.+)\*/);
          if (authorMatch) {
            author = authorMatch[1];
          }

          return { title, author, content: cleanContent };
        };

        const { title, author, content: versionContent } =
          parseContentForVersion(assistantMessageContent);

        const versionData = await storeContentVersion(
          sessionId,
          projectId,
          assistantMessageId,
          title,
          author,
          versionContent,
        );

        console.log(
          `Created content version ${versionData.version_number} for session ${sessionId}`,
        );

        // Note: Generated content is stored as a draft version and will only be added to the knowledge base
        // when the user explicitly publishes it. This ensures the RAG context is built only from approved,
        // published content, preventing duplication and maintaining content quality.
      } catch (versionError) {
        console.error("Failed to create content version:", versionError);
        // Don't fail the whole request if version creation fails
      }
    }

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
