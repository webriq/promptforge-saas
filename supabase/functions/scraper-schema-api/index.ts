import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  createOrUpdateBlog,
  generateSlug,
  parseAndCreateAuthorsCategories,
  storeKnowledgeBase,
} from "../_shared/rag-utils.ts";
import { openaiClient } from "../_shared/openai-client.ts";
import type { WebScrapingResult } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ScrapedContent {
  title: string;
  content: string;
  url: string;
  author?: string;
  publishedDate?: string;
  categories?: string[];
  excerpt?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { projectId, sessionId, urls, extractToSchema = true } = await req
      .json();

    if (!projectId || !sessionId || !urls || !Array.isArray(urls)) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameters: projectId, sessionId, urls",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[Schema Scraper] Processing ${urls.length} URLs for project: ${projectId}`,
    );

    const results: WebScrapingResult[] = [];

    for (const url of urls) {
      try {
        // First, scrape the content (reuse existing scraper logic)
        const scrapedContent = await scrapeUrlContent(url);

        if (scrapedContent.success) {
          let schemaData = undefined;

          if (extractToSchema) {
            // Extract structured data using AI
            const structuredData = await extractStructuredData(
              scrapedContent.content,
              url,
            );

            if (structuredData) {
              // Create blog entry in schema tables
              const { authors, categories } =
                await parseAndCreateAuthorsCategories(
                  structuredData.authors || [],
                  structuredData.categories || [],
                );

              // Create authors and categories objects for the jsonb fields
              const authorsObj = authors.reduce((acc, author) => {
                acc[author.slug] = {
                  id: author.id,
                  name: author.name,
                  slug: author.slug,
                };
                return acc;
              }, {} as Record<string, any>);

              const categoriesObj = categories.reduce((acc, category) => {
                acc[category.title] = {
                  id: category.id,
                  title: category.title,
                };
                return acc;
              }, {} as Record<string, any>);

              const blog = await createOrUpdateBlog(
                {
                  title: structuredData.title,
                  slug: generateSlug(structuredData.title),
                  content: structuredData.content,
                  excerpt: structuredData.excerpt,
                  authors: authorsObj,
                  categories: categoriesObj,
                },
                false,
              );

              schemaData = {
                blog,
                authors,
                categories,
              };
            }
          }

          // Store in knowledge base as well
          await storeKnowledgeBase(
            projectId,
            sessionId,
            scrapedContent.content,
            url,
            {
              type: "web_scraping",
              title: scrapedContent.title,
              scraped_at: new Date().toISOString(),
              extracted_to_schema: extractToSchema,
            },
          );

          results.push({
            url,
            title: scrapedContent.title,
            content: scrapedContent.content,
            success: true,
            schemaData,
          });
        } else {
          results.push({
            url,
            title: "",
            content: "",
            success: false,
            error: scrapedContent.error,
          });
        }
      } catch (error) {
        console.error(`Error processing URL ${url}:`, error);
        results.push({
          url,
          title: "",
          content: "",
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
        totalProcessed: results.length,
        successCount: results.filter((r) => r.success).length,
        schemaCreated: results.filter((r) => r.success && r.schemaData).length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Schema Scraper] Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function scrapeUrlContent(url: string): Promise<{
  success: boolean;
  title: string;
  content: string;
  error?: string;
}> {
  // This is a simplified version - in real implementation, you'd use
  // puppeteer or similar to scrape the actual content
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Basic HTML parsing - extract title and content
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : "Untitled";

    // Remove HTML tags and scripts for basic content extraction
    const content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      success: true,
      title,
      content: content.substring(0, 5000), // Limit content size
    };
  } catch (error) {
    return {
      success: false,
      title: "",
      content: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function extractStructuredData(content: string, url: string): Promise<
  {
    title: string;
    content: string;
    authors?: string[];
    categories?: string[];
    excerpt?: string;
    publishedDate?: string;
  } | null
> {
  try {
    const prompt = `
Analyze the following web page content and extract structured data in JSON format:

URL: ${url}
Content: ${content.substring(0, 2000)}...

Extract the following information:
1. title - Main title of the article/page
2. content - Clean, formatted content (remove navigation, ads, etc.)
3. authors - Array of author names if found
4. categories - Array of relevant categories/tags
5. excerpt - Brief summary (1-2 sentences)
6. publishedDate - Publication date in ISO format if found

Return ONLY a JSON object with these fields. If a field is not found, omit it or use null.

Example:
{
  "title": "Article Title",
  "content": "Clean article content...",
  "authors": ["Author Name"],
  "categories": ["Technology", "AI"],
  "excerpt": "Brief summary of the article.",
  "publishedDate": "2024-01-15T10:00:00Z"
}
`;

    const response = await openaiClient.createChatCompletion([
      {
        role: "system",
        content:
          "You are a content extraction assistant. Extract structured data from web pages and return only valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ]);

    const responseData = await response.json();
    const extractedText = responseData.choices[0].message.content;

    // Try to parse JSON from the response
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedData = JSON.parse(jsonMatch[0]);
      return parsedData;
    }

    return null;
  } catch (error) {
    console.error("Error extracting structured data:", error);
    return null;
  }
}
