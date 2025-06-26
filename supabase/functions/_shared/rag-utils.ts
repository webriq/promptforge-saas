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

// Content version management functions
export async function storeContentVersion(
  sessionId: string,
  projectId: string,
  messageId: string,
  title: string,
  author: string,
  content: string,
): Promise<{ id: string; version_number: number }> {
  try {
    // Get the next version number for this session
    const { data: existingVersions, error: countError } = await supabaseAdmin
      .from("content_versions")
      .select("version_number")
      .eq("session_id", sessionId)
      .order("version_number", { ascending: false })
      .limit(1);

    if (countError) {
      throw new Error(`Failed to get version count: ${countError.message}`);
    }

    const nextVersionNumber = existingVersions && existingVersions.length > 0
      ? existingVersions[0].version_number + 1
      : 1;

    // Store the new version
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .insert({
        session_id: sessionId,
        project_id: projectId,
        message_id: messageId,
        version_number: nextVersionNumber,
        title,
        author,
        content,
      })
      .select("id, version_number")
      .single();

    if (error) {
      throw new Error(`Failed to store content version: ${error.message}`);
    }

    console.log(
      `Stored content version ${nextVersionNumber} for session ${sessionId}`,
    );
    return data;
  } catch (error) {
    console.error("Error storing content version:", error);
    throw error;
  }
}

export async function getContentVersions(
  sessionId: string,
): Promise<
  Array<{
    id: string;
    version_number: number;
    title: string;
    author: string;
    content: string;
    created_at: string;
    message_id: string;
  }>
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select(
        "id, version_number, title, author, content, created_at, message_id",
      )
      .eq("session_id", sessionId)
      .order("version_number", { ascending: false });

    if (error) {
      throw new Error(`Failed to get content versions: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error("Error getting content versions:", error);
    return [];
  }
}

export async function getContentVersion(
  versionId: string,
): Promise<
  {
    id: string;
    version_number: number;
    title: string;
    author: string;
    content: string;
    created_at: string;
  } | null
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select("id, version_number, title, author, content, created_at")
      .eq("id", versionId)
      .single();

    if (error) {
      throw new Error(`Failed to get content version: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error("Error getting content version:", error);
    return null;
  }
}

export async function getLatestContentVersion(
  sessionId: string,
): Promise<
  {
    id: string;
    version_number: number;
    title: string;
    author: string;
    content: string;
    created_at: string;
  } | null
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select("id, version_number, title, author, content, created_at")
      .eq("session_id", sessionId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("No content versions found or error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error getting latest content version:", error);
    return null;
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

export async function buildSessionSpecificRAGContext(
  projectId: string,
  sessionId: string,
  query: string,
): Promise<RAGContext> {
  const [chatHistory, relevantKnowledge] = await Promise.all([
    getChatHistory(sessionId),
    retrieveSessionSpecificKnowledge(projectId, sessionId, query),
  ]);

  return {
    chatHistory: chatHistory.slice(-10), // Last 10 messages for context
    relevantKnowledge,
  };
}

async function retrieveSessionSpecificKnowledge(
  projectId: string,
  sessionId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeBaseEntry[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);

    // Search for session-specific content first
    const { data, error } = await supabaseAdmin.rpc(
      "search_knowledge_base_updated",
      {
        input_project_id: projectId,
        input_session_id: sessionId, // Search session-specific content
        query_embedding: queryEmbedding,
        similarity_threshold: 0.3, // Lower threshold for session-specific content
        match_count: limit,
      },
    );

    if (error) {
      console.error("Error with session-specific RPC function:", error);

      // Fallback to direct query for session-specific content
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin
        .from("knowledge_base")
        .select("*")
        .eq("project_id", projectId)
        .eq("session_id", sessionId)
        .limit(limit);

      if (fallbackError) {
        console.error("Session-specific fallback query failed:", fallbackError);
        return [];
      }

      return fallbackData || [];
    }

    console.log("Session-specific knowledge entries:", data?.length || 0);
    return data || [];
  } catch (error) {
    console.error("Exception in retrieveSessionSpecificKnowledge:", error);
    return [];
  }
}
