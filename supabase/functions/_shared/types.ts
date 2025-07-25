export interface ChatSession {
  id: string;
  user_id?: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, any>;
  attachments?: {
    fileName: string;
    fileSize: number;
    fileType: string;
  }[];
  created_at: string;
}

export interface KnowledgeBaseEntry {
  id: string;
  session_id: string;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
  created_at: string;
}

export interface RAGContext {
  chatHistory: ChatMessage[];
  relevantKnowledge: KnowledgeBaseEntry[];
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// New schema table interfaces - Updated to match actual DB structure
export interface AuthorSchema {
  id: string;
  name: string;
  slug: string;
  bio?: string;
  thumbnail_img?: string;
  referenced_by?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CategorySchema {
  id: string;
  title: string;
  description?: string;
  referenced_by?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface BlogSchema {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  authors?: Record<string, any>; // jsonb field
  categories?: Record<string, any>; // jsonb field
  thumbnail_img?: Record<string, any>; // jsonb field
  seo_fields?: Record<string, any>; // jsonb field
  created_at: string;
  updated_at: string;
}

export interface SchemaSearchResult {
  table_name: string;
  id: string;
  title: string;
  content: string;
  slug: string;
  created_at: string;
}

export interface BlogPublishRequest {
  content: string;
  title: string;
  author: string;
  categories?: string[];
  versionId: string;
  projectId: string;
  slug?: string;
  excerpt?: string;
  thumbnail?: {
    url: string;
    alt: string;
  };
  overwrite?: boolean;
}

export interface WebScrapingResult {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
  schemaData?: {
    blog?: BlogSchema;
    authors?: AuthorSchema[];
    categories?: CategorySchema[];
  };
}
