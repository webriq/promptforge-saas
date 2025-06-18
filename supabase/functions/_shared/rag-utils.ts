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
  sessionId: string,
  content: string,
  metadata: Record<string, any> = {},
): Promise<void> {
  const embedding = await generateEmbedding(content);

  const { error } = await supabaseAdmin.from("knowledge_base").insert({
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
  sessionId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeBaseEntry[]> {
  const queryEmbedding = await generateEmbedding(query);

  // Use a custom function for vector similarity search
  const { data, error } = await supabaseAdmin.rpc("search_knowledge_base", {
    session_id: sessionId,
    query_embedding: queryEmbedding,
    similarity_threshold: 0.7,
    match_count: limit,
  });

  if (error) {
    console.error("Error retrieving knowledge:", error);
    return [];
  }

  return data || [];
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
  sessionId: string,
  query: string,
): Promise<RAGContext> {
  const [chatHistory, relevantKnowledge] = await Promise.all([
    getChatHistory(sessionId),
    retrieveRelevantKnowledge(sessionId, query),
  ]);

  return {
    chatHistory: chatHistory.slice(-10), // Last 10 messages for context
    relevantKnowledge,
  };
}
