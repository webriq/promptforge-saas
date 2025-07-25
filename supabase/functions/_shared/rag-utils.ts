import { supabaseAdmin } from "../_shared/supabase.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import type {
  AuthorSchema,
  BlogSchema,
  CategorySchema,
  ChatMessage,
  KnowledgeBaseEntry,
  RAGContext,
  SchemaSearchResult,
} from "../_shared/types.ts";

export async function generateEmbedding(text: string): Promise<number[]> {
  return await openaiClient.createEmbedding(text);
}

export async function storeKnowledgeBase(
  projectId: string,
  sessionId: string,
  content: string,
  source: string,
  metadata: Record<string, any> = {},
): Promise<void> {
  const embedding = await generateEmbedding(content);

  const { error } = await supabaseAdmin.from("knowledge_base").insert({
    project_id: projectId,
    session_id: sessionId,
    content,
    source,
    metadata,
    embedding,
  });

  if (error) {
    throw new Error(`Failed to store knowledge: ${error.message}`);
  }
}

// New function for bulk content storage with source tracking
export async function storeBulkKnowledgeBase(
  projectId: string,
  sessionId: string,
  contentItems: Array<{
    content: string;
    source: string;
    metadata?: Record<string, any>;
  }>,
): Promise<void> {
  console.log(`Storing ${contentItems.length} items to knowledge base`);

  // Process embeddings for all content items
  const embeddings = await Promise.all(
    contentItems.map((item) => generateEmbedding(item.content)),
  );

  // Prepare data for bulk insert
  const dataToInsert = contentItems.map((item, index) => ({
    project_id: projectId,
    session_id: sessionId,
    content: item.content,
    source: item.source,
    metadata: item.metadata || {},
    embedding: embeddings[index],
  }));

  const { error } = await supabaseAdmin.from("knowledge_base").insert(
    dataToInsert,
  );

  if (error) {
    throw new Error(`Failed to store bulk knowledge: ${error.message}`);
  }

  console.log(
    `Successfully stored ${contentItems.length} items to knowledge base`,
  );
}

// Helper function to chunk content for better embedding storage
export function chunkContent(
  text: string,
  maxChunkSize: number = 1000,
  overlapSize: number = 100,
): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + maxChunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);

    // Try to break at sentence boundaries
    if (endIndex < text.length) {
      const lastSentenceEnd = Math.max(
        chunk.lastIndexOf("."),
        chunk.lastIndexOf("!"),
        chunk.lastIndexOf("?"),
      );

      if (lastSentenceEnd > maxChunkSize * 0.7) {
        chunks.push(chunk.slice(0, lastSentenceEnd + 1).trim());
        startIndex = startIndex + lastSentenceEnd + 1;
      } else {
        chunks.push(chunk.trim());
        startIndex = endIndex - overlapSize;
      }
    } else {
      chunks.push(chunk.trim());
      break;
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
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
        published: false, // New versions are not published by default
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
    published: boolean;
    published_at: string | null;
  }>
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select(
        "id, version_number, title, author, content, created_at, message_id, published, published_at",
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
    published: boolean;
    published_at: string | null;
  } | null
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select(
        "id, version_number, title, author, content, created_at, published, published_at",
      )
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
    published: boolean;
    published_at: string | null;
  } | null
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select(
        "id, version_number, title, author, content, created_at, published, published_at",
      )
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

// Helper function to get session and project IDs from version ID
export async function getContentVersionDetails(
  versionId: string,
): Promise<
  {
    id: string | undefined;
    sessionId: string;
    projectId: string;
    createdAt: string;
    document_id: string;
  } | null
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select("id, session_id, project_id, created_at, document_id")
      .eq("id", versionId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      sessionId: data.session_id,
      projectId: data.project_id,
      createdAt: data.created_at,
      document_id: data.document_id,
    };
  } catch (error) {
    console.error("Error getting content version details:", error);
    return null;
  }
}

// Helper function to find existing published blog ID for the same content
export async function getExistingPublishedBlogId(
  sessionId: string,
  projectId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .select("document_id")
      .eq("session_id", sessionId)
      .eq("project_id", projectId)
      .eq("published", true)
      .not("document_id", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data.document_id;
  } catch (error) {
    console.error("Error getting existing published blog ID:", error);
    return null;
  }
}

// New function to mark a content version as published
export async function markContentVersionAsPublished(
  versionId: string | null | undefined,
  blogId?: string,
  blogCreatedAt?: string,
  isPublished?: boolean | undefined,
  isUpdated?: boolean,
): Promise<{ success: boolean; published_at: string | null }> {
  try {
    const publishedAt = blogCreatedAt || new Date().toISOString();

    const updateData: {
      published: boolean | undefined;
      published_at: string;
      document_id?: string;
      updated_at?: string | null;
    } = {
      published: isPublished,
      published_at: publishedAt,
      updated_at: isUpdated ? new Date().toISOString() : null,
    };

    // Only set document_id if blogId is provided
    if (blogId) {
      updateData.document_id = blogId;
    }

    const { data, error } = await supabaseAdmin
      .from("content_versions")
      .update(updateData)
      .eq("id", versionId)
      .select("published_at")
      .single();

    if (error) {
      throw new Error(
        `Failed to mark content version as published: ${error.message}`,
      );
    }

    console.log(
      `Content version ${versionId} marked as published at ${publishedAt}${
        blogId ? ` with document_id ${blogId}` : ""
      }`,
    );
    return { success: true, published_at: data.published_at };
  } catch (error) {
    console.error("Error marking content version as published:", error);
    return { success: false, published_at: null };
  }
}

export async function retrieveRelevantKnowledge(
  projectId: string,
  query: string,
  limit = 5,
): Promise<KnowledgeBaseEntry[]> {
  try {
    console.log(`[RAG] Retrieving knowledge for project: ${projectId}`);
    console.log(`[RAG] Query: "${query}"`);

    const queryEmbedding = await generateEmbedding(query);

    // First, try the custom function for vector similarity search
    // Focus on project-wide knowledge base, not session-specific
    const { data, error } = await supabaseAdmin.rpc(
      "search_knowledge_base_updated",
      {
        input_project_id: projectId,
        query_embedding: queryEmbedding,
        input_session_id: null, // Pass null to search across all sessions in the project
        similarity_threshold: 0.3, // Lower threshold for better matches
        match_count: limit,
      },
    );

    if (error) {
      console.error("[RAG] Error with RPC function:", error);

      // Fallback to direct query if RPC function fails
      console.log("[RAG] Falling back to direct query...");
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin
        .from("knowledge_base")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (fallbackError) {
        console.error("[RAG] Fallback query also failed:", fallbackError);
        return [];
      }

      console.log(
        `[RAG] Fallback retrieved entries: ${fallbackData?.length || 0}`,
      );
      if (fallbackData && fallbackData.length > 0) {
        console.log(
          `[RAG] Fallback sources: ${
            fallbackData.map((d: any) => d.source).join(", ")
          }`,
        );
      }
      return fallbackData || [];
    }

    console.log(`[RAG] RPC retrieved knowledge entries: ${data?.length || 0}`);
    if (data && data.length > 0) {
      console.log(
        `[RAG] Retrieved sources: ${data.map((d: any) => d.source).join(", ")}`,
      );
      console.log(
        `[RAG] Generated content count: ${
          data.filter((d: any) => d.source === "generated_content").length
        }`,
      );
    } else {
      console.log(
        "[RAG] No relevant knowledge found, trying broader search...",
      );

      // If no results, try a broader search without similarity threshold
      const { data: broaderData, error: broaderError } = await supabaseAdmin
        .from("knowledge_base")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(limit * 2); // Get more results for broader search

      if (broaderError) {
        console.error("[RAG] Broader search failed:", broaderError);
        return [];
      }

      console.log(
        `[RAG] Broader search retrieved entries: ${broaderData?.length || 0}`,
      );
      if (broaderData && broaderData.length > 0) {
        console.log(
          `[RAG] Broader search sources: ${
            broaderData.map((d: any) => d.source).join(", ")
          }`,
        );
      }
      return broaderData || [];
    }

    return data || [];
  } catch (error) {
    console.error("[RAG] Exception in retrieveRelevantKnowledge:", error);
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
  console.log(
    `[RAG Context] Building context for project: ${projectId}, session: ${sessionId}`,
  );
  console.log(`[RAG Context] Query: "${query}"`);

  const [chatHistory, relevantKnowledge, schemaData] = await Promise.all([
    getChatHistory(sessionId),
    retrieveRelevantKnowledge(projectId, query),
    searchSchemaContent(query, 5),
  ]);

  console.log(`[RAG Context] Chat history: ${chatHistory.length} messages`);
  console.log(
    `[RAG Context] Relevant knowledge: ${relevantKnowledge.length} entries`,
  );
  console.log(`[RAG Context] Schema data: ${schemaData.length} entries`);

  if (relevantKnowledge.length > 0) {
    const generatedContentCount = relevantKnowledge.filter((k: any) =>
      k.source === "generated_content"
    ).length;
    console.log(
      `[RAG Context] Generated content entries: ${generatedContentCount}`,
    );

    if (generatedContentCount > 0) {
      console.log(
        `[RAG Context] Generated content found - previous AI content available for expansion`,
      );
    }
  }

  return {
    chatHistory: chatHistory.slice(-10), // Last 10 messages for context
    relevantKnowledge,
    schemaData,
  };
}

// Schema management functions - Updated to match actual DB structure
export async function createOrUpdateAuthor(
  authorData: {
    name: string;
    slug: string;
    bio?: string;
    thumbnail_img?: string;
    referenced_by?: Record<string, any>;
  },
): Promise<AuthorSchema> {
  const { data, error } = await supabaseAdmin
    .from("author_schema")
    .upsert(authorData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create/update author: ${error.message}`);
  }

  return data;
}

export async function createOrUpdateCategory(
  categoryData: {
    title: string;
    description?: string;
    referenced_by?: Record<string, any>;
  },
): Promise<CategorySchema> {
  const { data, error } = await supabaseAdmin
    .from("category_schema")
    .upsert(categoryData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create/update category: ${error.message}`);
  }

  return data;
}

export async function createOrUpdateBlog(
  blogData: {
    title: string;
    slug: string;
    content: string;
    excerpt?: string;
    authors?: Record<string, any>;
    categories?: Record<string, any>;
    thumbnail_img?: Record<string, any>;
    seo_fields?: Record<string, any>;
    content_version_id?: string;
  },
  overwrite = false,
  existingBlogId?: string,
): Promise<BlogSchema> {
  let existingBlog = null;

  // First, check if we have a specific blog ID to update
  if (existingBlogId) {
    const { data } = await supabaseAdmin
      .from("blog_schema")
      .select("id")
      .eq("id", existingBlogId)
      .single();
    existingBlog = data;
  }

  // If no specific blog ID, check by slug
  if (!existingBlog) {
    const { data } = await supabaseAdmin
      .from("blog_schema")
      .select("id")
      .eq("slug", blogData.slug)
      .single();
    existingBlog = data;
  }

  if (existingBlog && !overwrite) {
    throw new Error(
      `Blog with slug '${blogData.slug}' already exists. Set overwrite=true to update.`,
    );
  }

  let data, error;

  if (existingBlog && overwrite) {
    // Update existing blog
    ({ data, error } = await supabaseAdmin
      .from("blog_schema")
      .update(blogData)
      .eq("id", existingBlog.id)
      .select()
      .single());
  } else {
    // Create new blog
    ({ data, error } = await supabaseAdmin
      .from("blog_schema")
      .insert(blogData)
      .select()
      .single());
  }

  if (error) {
    throw new Error(`Failed to create/update blog: ${error.message}`);
  }

  return data;
}

export async function getAuthors(): Promise<AuthorSchema[]> {
  const { data, error } = await supabaseAdmin
    .from("author_schema")
    .select("*")
    .order("name");

  if (error) {
    throw new Error(`Failed to get authors: ${error.message}`);
  }

  return data || [];
}

export async function getCategories(): Promise<CategorySchema[]> {
  const { data, error } = await supabaseAdmin
    .from("category_schema")
    .select("*")
    .order("title");

  if (error) {
    throw new Error(`Failed to get categories: ${error.message}`);
  }

  return data || [];
}

export async function getBlogs(): Promise<BlogSchema[]> {
  const { data, error } = await supabaseAdmin
    .from("blog_schema")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to get blogs: ${error.message}`);
  }

  return data || [];
}

export async function getBlogBySlug(slug: string): Promise<BlogSchema | null> {
  const { data, error } = await supabaseAdmin
    .from("blog_schema")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) {
    return null;
  }

  return data;
}

export async function getBlogWithAuthorsAndCategories(
  slug: string,
): Promise<
  {
    blog: BlogSchema;
    authors: AuthorSchema[];
    categories: CategorySchema[];
  } | null
> {
  const blog = await getBlogBySlug(slug);
  if (!blog) return null;

  // Extract author and category data from the jsonb fields
  const authorSlugs = blog.authors ? Object.keys(blog.authors) : [];
  const categoryTitles = blog.categories ? Object.keys(blog.categories) : [];

  const [authors, categories] = await Promise.all([
    getAuthorsBySlugs(authorSlugs),
    getCategoriesByTitles(categoryTitles),
  ]);

  return {
    blog,
    authors,
    categories,
  };
}

export async function getAuthorsBySlugs(
  slugs: string[],
): Promise<AuthorSchema[]> {
  if (slugs.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("author_schema")
    .select("*")
    .in("slug", slugs);

  if (error) {
    throw new Error(`Failed to get authors by slugs: ${error.message}`);
  }

  return data || [];
}

export async function getCategoriesByTitles(
  titles: string[],
): Promise<CategorySchema[]> {
  if (titles.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("category_schema")
    .select("*")
    .in("title", titles);

  if (error) {
    throw new Error(`Failed to get categories by titles: ${error.message}`);
  }

  return data || [];
}

export async function searchSchemaContent(
  query: string,
  limit = 10,
): Promise<SchemaSearchResult[]> {
  try {
    // Search across all schema tables
    const [blogResults, authorResults, categoryResults] = await Promise.all([
      supabaseAdmin
        .from("blog_schema")
        .select("id, title, content, slug, created_at")
        .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
        .limit(limit),
      supabaseAdmin
        .from("author_schema")
        .select("id, name, bio, slug, created_at")
        .or(`name.ilike.%${query}%,bio.ilike.%${query}%`)
        .limit(limit),
      supabaseAdmin
        .from("category_schema")
        .select("id, title, description, created_at")
        .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(limit),
    ]);

    const results: SchemaSearchResult[] = [];

    // Process blog results
    if (blogResults.data) {
      results.push(
        ...blogResults.data.map((item) => ({
          table_name: "blog_schema",
          id: item.id,
          title: item.title,
          content: item.content || "",
          slug: item.slug,
          created_at: item.created_at,
        })),
      );
    }

    // Process author results
    if (authorResults.data) {
      results.push(
        ...authorResults.data.map((item) => ({
          table_name: "author_schema",
          id: item.id,
          title: item.name,
          content: item.bio || "",
          slug: item.slug,
          created_at: item.created_at,
        })),
      );
    }

    // Process category results
    if (categoryResults.data) {
      results.push(
        ...categoryResults.data.map((item) => ({
          table_name: "category_schema",
          id: item.id,
          title: item.title,
          content: item.description || "",
          slug: item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          created_at: item.created_at,
        })),
      );
    }

    return results.slice(0, limit);
  } catch (error) {
    console.error("Exception in searchSchemaContent:", error);
    return [];
  }
}

// Helper function to generate slug from title
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Helper function to parse author and category names and create/get them
export async function parseAndCreateAuthorsCategories(
  authorNames: string[],
  categoryNames: string[],
): Promise<{
  authors: AuthorSchema[];
  categories: CategorySchema[];
}> {
  const authors: AuthorSchema[] = [];
  const categories: CategorySchema[] = [];

  // Process authors
  for (const authorName of authorNames) {
    if (authorName.trim()) {
      const slug = generateSlug(authorName);
      const author = await createOrUpdateAuthor({
        name: authorName.trim(),
        slug,
        bio: `Author profile for ${authorName}`,
      });
      authors.push(author);
    }
  }

  // Process categories
  for (const categoryName of categoryNames) {
    if (categoryName.trim()) {
      const category = await createOrUpdateCategory({
        title: categoryName.trim(),
        description: `Category for ${categoryName}`,
      });
      categories.push(category);
    }
  }

  return { authors, categories };
}
