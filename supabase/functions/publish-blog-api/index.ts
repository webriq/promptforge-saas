import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  createOrUpdateBlog,
  generateSlug,
  getBlogBySlug,
  getContentVersionDetails,
  getExistingPublishedBlogId,
  markContentVersionAsPublished,
  parseAndCreateAuthorsCategories,
  unpublishAllPreviousVersions,
} from "../_shared/rag-utils.ts";
import type { BlogPublishRequest } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const requestData: BlogPublishRequest = await req.json();
    const {
      content,
      title,
      author,
      categories = [],
      versionId,
      slug,
      excerpt,
      thumbnail,
      overwrite = false,
    } = requestData;

    if (!content || !title || !author || !versionId) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: content, title, author, versionId",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[Blog Publish API] Publishing blog: ${title}`,
    );

    // Generate slug if not provided
    const blogSlug = slug || generateSlug(title);

    // Get content version details to find existing published blog for same content
    const versionDetails = await getContentVersionDetails(versionId);
    let existingBlogId = null;

    if (versionDetails) {
      existingBlogId = await getExistingPublishedBlogId(
        versionDetails.sessionId,
        versionDetails.projectId,
      );
    }

    // Check if blog already exists by slug (for new content)
    if (!existingBlogId) {
      const existingBlog = await getBlogBySlug(blogSlug);
      if (existingBlog && !overwrite) {
        return new Response(
          JSON.stringify({
            error: "Blog with this slug already exists",
            exists: true,
            existingBlog: {
              id: existingBlog.id,
              title: existingBlog.title,
              slug: existingBlog.slug,
            },
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } else {
      // If we have an existing blog ID, we're updating existing content
      console.log(
        `[Blog Publish API] Updating existing blog with ID: ${existingBlogId}`,
      );
    }

    // Parse and create authors and categories
    const authorNames = Array.isArray(author) ? author : [author];
    const categoryNames = Array.isArray(categories) ? categories : categories;

    const { authors, categories: createdCategories } =
      await parseAndCreateAuthorsCategories(
        authorNames,
        categoryNames,
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

    const categoriesObj = createdCategories.reduce((acc, category) => {
      acc[category.title] = {
        id: category.id,
        title: category.title,
      };
      return acc;
    }, {} as Record<string, any>);

    // Create blog data
    const blogData = {
      title,
      slug: blogSlug,
      content,
      excerpt: excerpt || content.substring(0, 200) + "...",
      authors: authorsObj,
      categories: categoriesObj,
      thumbnail_img: thumbnail
        ? {
          url: thumbnail.url,
          alt: thumbnail.alt,
        }
        : undefined,
      seo_fields: {
        title: title,
        description: excerpt || content.substring(0, 160),
      },
      content_version_id: versionId,
    };

    // Create or update blog
    const blog = await createOrUpdateBlog(
      blogData,
      overwrite,
      existingBlogId || undefined,
    );

    // Unpublish all previous versions for this session/project
    if (versionDetails) {
      console.log(
        `Unpublishing all previous versions for session: ${versionDetails.sessionId}, project: ${versionDetails.projectId}`,
      );

      const unpublishResult = await unpublishAllPreviousVersions(
        versionDetails.sessionId,
        versionDetails.projectId,
        versionId, // Exclude the current version being published
      );

      if (unpublishResult.success) {
        console.log(
          `Successfully unpublished ${unpublishResult.unpublishedCount} previous versions`,
        );
      } else {
        console.error("Failed to unpublish previous versions");
        // Continue anyway - we still want to publish the current version
      }
    }

    // Mark current content version as published
    const publishResult = await markContentVersionAsPublished(
      versionId,
      blog.id,
      blog.created_at,
      true, // Mark as published
    );
    if (!publishResult.success) {
      console.error("Failed to mark content version as published");
      // Continue anyway - the blog was created successfully
    }

    console.log(
      `[Blog Publish API] Successfully published blog: ${blog.title}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        blog: {
          id: blog.id,
          title: blog.title,
          slug: blog.slug,
        },
        authors: authors.map((a) => ({ id: a.id, name: a.name })),
        categories: createdCategories.map((c) => ({
          id: c.id,
          title: c.title,
        })),
        message: "Blog published successfully",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Blog Publish API] Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
