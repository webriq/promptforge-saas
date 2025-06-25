import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import type {
  ChatMessage,
  KnowledgeBaseEntry,
  RAGContext,
} from "../_shared/types.ts";

export async function generateEmbedding(text: string): Promise<number[]> {
  return await openaiClient.createEmbedding(text);
}

export async function storeKnowledgeBase(
  projectId: string,
  sessionId: string,
  content: string,
  metadata: Record<string, any> = {},
): Promise<void> {
  const embedding = await generateEmbedding(content);

  const { error } = await supabaseAdmin.from("knowledge_base").insert({
    project_id: projectId,
    session_id: sessionId,
    content,
    metadata,
    embedding,
  });

  if (error) {
    throw new Error(`Failed to store knowledge: ${error.message}`);
  }
}

export async function retrieveRelevantKnowledge(
  projectId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeBaseEntry[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);

    // First, try the custom function for vector similarity search
    // Focus on project-wide knowledge base, not session-specific
    const { data, error } = await supabaseAdmin.rpc(
      "search_knowledge_base_updated",
      {
        input_project_id: projectId,
        input_session_id: null, // Pass null to search across all sessions in the project
        query_embedding: queryEmbedding,
        similarity_threshold: 0.5, // Lower threshold for better matches
        match_count: limit,
      },
    );

    if (error) {
      console.error("Error with RPC function:", error);

      // Fallback to direct query if RPC function fails
      console.log("Falling back to direct query...");
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin
        .from("knowledge_base")
        .select("*")
        .eq("project_id", projectId)
        .limit(limit);

      if (fallbackError) {
        console.error("Fallback query also failed:", fallbackError);
        return [];
      }

      console.log("Fallback retrieved entries:", fallbackData?.length || 0);
      return fallbackData || [];
    }

    console.log("RPC retrieved knowledge entries:", data?.length || 0);
    return data || [];
  } catch (error) {
    console.error("Exception in retrieveRelevantKnowledge:", error);
    return [];
  }
}

export async function getChatHistory(
  sessionId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get chat history: ${error.message}`);
  }

  return data || [];
}

export async function buildRAGContext(
  projectId: string,
  sessionId: string,
  query: string,
): Promise<RAGContext> {
  const [chatHistory, relevantKnowledge] = await Promise.all([
    getChatHistory(sessionId),
    retrieveRelevantKnowledge(projectId, query),
  ]);

  return {
    chatHistory: chatHistory.slice(-10), // Last 10 messages for context
    relevantKnowledge,
  };
}
