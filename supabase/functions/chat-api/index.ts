import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import {
  buildRAGContext,
  buildSessionSpecificRAGContext,
  storeContentVersion,
  storeKnowledgeBase,
} from "../_shared/rag-utils.ts";
import type { ChatMessage, OpenAIMessage } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper function to detect schema-related queries
const isSchemaQuery = (content: string): boolean => {
  const schemaKeywords = [
    "pages", "components", "global seo", "documents", "schemas", "structure",
    "content types", "page types", "component types", "site structure",
    "what pages", "what components", "list pages", "list components",
    "show pages", "show components", "available pages", "available components",
    "current pages", "current components", "existing pages", "existing components",
    "page structure", "component structure", "site architecture"
  ];
  
  const lowerContent = content.toLowerCase();
  return schemaKeywords.some(keyword => lowerContent.includes(keyword));
};

// Helper function to get schema data from project_schemas table
const getSchemaData = async (projectId: string) => {
  const { data: schemas, error } = await supabaseAdmin
    .from("project_schemas")
    .select("sanity_pages, sanity_components, sanity_global_seo")
    .eq("app_project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching schema data:", error);
    return null;
  }

  return schemas && schemas.length > 0 ? schemas[0] : null;
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

    // Check if this is a schema-related query
    const isSchemaRelatedQuery = isSchemaQuery(userMessage.content);

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

    // If user has attachments, prioritize session-specific content for immediate access
    let relevantKnowledge;
    let chatHistory;
    let schemaContext = "";

    if (userMessage.attachments && userMessage.attachments.length > 0) {
      // For messages with attachments, search both project-wide and session-specific
      const [projectContext, sessionContext] = await Promise.all([
        buildRAGContext(projectId, sessionId, searchQuery),
        buildSessionSpecificRAGContext(projectId, sessionId, searchQuery),
      ]);

      // Combine and prioritize session-specific content
      relevantKnowledge = [
        ...sessionContext.relevantKnowledge,
        ...projectContext.relevantKnowledge,
      ].slice(0, 8); // Take top 8 most relevant

      chatHistory = projectContext.chatHistory;
    } else {
      // For regular messages without attachments, use standard search
      const context = await buildRAGContext(projectId, sessionId, searchQuery);
      relevantKnowledge = context.relevantKnowledge;
      chatHistory = context.chatHistory;
    }

    // If this is a schema-related query, fetch and include schema data
    if (isSchemaRelatedQuery) {
      const schemaData = await getSchemaData(projectId);
      if (schemaData) {
        let schemaInfo = "\n\nPROJECT SCHEMA INFORMATION:\n";
        
        if (schemaData.sanity_pages && schemaData.sanity_pages.result) {
          schemaInfo += `\nPAGES (${schemaData.sanity_pages.result.length} total):\n`;
          schemaData.sanity_pages.result.forEach((page: any, index: number) => {
            schemaInfo += `${index + 1}. ${page.title || page._type} (Type: ${page._type})\n`;
          });
        }
        
        if (schemaData.sanity_components && schemaData.sanity_components.result) {
          schemaInfo += `\nCOMPONENTS (${schemaData.sanity_components.result.length} total):\n`;
          schemaData.sanity_components.result.forEach((component: any, index: number) => {
            schemaInfo += `${index + 1}. ${component.title || component._type} (Type: ${component._type})\n`;
          });
        }
        
        if (schemaData.sanity_global_seo && schemaData.sanity_global_seo.result) {
          schemaInfo += `\nGLOBAL SEO SETTINGS (${schemaData.sanity_global_seo.result.length} total):\n`;
          schemaData.sanity_global_seo.result.forEach((seo: any, index: number) => {
            schemaInfo += `${index + 1}. ${seo.title || seo._type} (Type: ${seo._type})\n`;
          });
        }
        
        schemaContext = schemaInfo;
      }
    }

    const context = relevantKnowledge?.map((k) => k.content).join("\n\n") || "";
    const fullContext = context + schemaContext;

    const systemPrompt =
      `You are a helpful AI assistant for our company dedicated to generating AI-ready content. Get information from the "Knowledge base" to answer questions.
      
      ROLE AND PURPOSE: Assist users in generating content guided by LLM-readiness criteria using the provided context. The generated content should be well-structured, informative, and engaging.
      
      TONE: Professional, conversational, and helpful — never robotic or overly verbose.

      CONTENT GUIDELINES:
      - Generate content that meet high scores on the following criteria:
        1. Content Clarity - messaging effectiveness
        2. Fact Attribution - citations/references
        3. Reading Simplicity - readability metrics

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
      - When files are uploaded, their content appears in the Knowledge base immediately
      - Previously generated content is also stored in the Knowledge base (marked as "generated_content" type)
      - When asked to expand, modify, or build upon previous content, reference the existing generated content from the Knowledge base
      - For file analysis requests, examine ALL available content from the Knowledge base
      - Provide detailed analysis of uploaded documents when requested
      - Never generate generic content without specific context
      - Do not create fictional or placeholder information
      - If analyzing files, reference specific sections and provide concrete recommendations
      - When expanding content, always build upon the existing generated content rather than starting from scratch

      SCHEMA QUERIES:
      - When users ask about their pages, components, or site structure, use the PROJECT SCHEMA INFORMATION section below
      - Provide detailed lists and explanations of available pages, components, and SEO settings
      - Help users understand their current content structure and suggest improvements
      - When analyzing schema data, provide insights about content organization and potential optimizations
      
      ${
        userMessage.attachments && userMessage.attachments.length > 0
          ? `IMPORTANT: The user has uploaded files in this conversation. You should find content from these files in the Knowledge base below. Use this content to provide detailed analysis and recommendations.`
          : ""
      }
      
      ${
        isSchemaRelatedQuery
          ? `IMPORTANT: The user is asking about their project structure/schemas. Use the PROJECT SCHEMA INFORMATION section below to provide detailed information about their pages, components, and SEO settings.`
          : ""
      }
      
      Knowledge base context:
      ${fullContext}
      
      ${
        fullContext.trim() === ""
          ? "IMPORTANT: No knowledge base content found for this project. This means no files have been uploaded yet, or the uploaded content doesn't match the query. You MUST inform the user that they need to upload relevant documents (PDF or text files) to get started. Do NOT generate generic content."
          : userMessage.attachments && userMessage.attachments.length > 0
          ? "The above knowledge base content includes information from recently uploaded files. Use this content to provide detailed analysis and generate improved content as requested."
          : isSchemaRelatedQuery
          ? "The above knowledge base content includes your project schema information. Use this to provide detailed information about your pages, components, and SEO settings."
          : "Use the above knowledge base content to inform your response. This includes both uploaded documents and any previously generated content (marked as 'generated_content' type). When expanding or modifying content, reference and build upon the existing generated content."
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
    const response = await openaiClient.createChatCompletion(conversation);
    const aiResponseData = await response.json();
    const aiResponseContent = aiResponseData.choices[0].message.content;

    if (!aiResponseContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    // Store assistant message
    const { data: assistantMessage, error: assistantError } =
      await supabaseAdmin
        .from("chat_messages")
        .insert({
          session_id: sessionId,
          role: "assistant",
          content: aiResponseContent,
        })
        .select("id")
        .single();

    if (assistantError) {
      throw new Error(
        `Failed to store assistant message: ${assistantError.message}`,
      );
    }

    // Check if the response contains generated content and create a version
    const hasGeneratedContent = aiResponseContent.includes("====") ||
      (aiResponseContent.includes("# ") && aiResponseContent.length > 200);

    if (hasGeneratedContent) {
      try {
        // Parse the content to extract title and author
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
          parseContentForVersion(aiResponseContent);

        const versionData = await storeContentVersion(
          sessionId,
          projectId,
          assistantMessage.id,
          title,
          author,
          versionContent,
        );

        console.log(
          `Created content version ${versionData.version_number} for session ${sessionId}`,
        );

        // Also store the generated content in the knowledge base for future reference
        try {
          await storeKnowledgeBase(
            projectId,
            sessionId,
            versionContent,
            {
              type: "generated_content",
              title: title,
              author: author,
              version_number: versionData.version_number,
              message_id: assistantMessage.id,
              generated_at: new Date().toISOString(),
            },
          );
          console.log(
            `Stored generated content in knowledge base for session ${sessionId}`,
          );
        } catch (knowledgeError) {
          console.error(
            "Failed to store generated content in knowledge base:",
            knowledgeError,
          );
          // Don't fail the whole request if knowledge storage fails
        }
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
