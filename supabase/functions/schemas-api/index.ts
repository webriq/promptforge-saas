import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { getAuthors, getBlogs, getCategories } from "../_shared/rag-utils.ts";

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
    const {
      action,
      projectId,
      dataset,
      components,
      pages,
      globalSeo,
      appProjectId,
      status,
    } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter 'action'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseClient = supabaseAdmin;

    let data;

    if (action === "get_authors") {
      data = await getAuthors();
    } else if (action === "get_categories") {
      data = await getCategories();
    } else if (action === "get_blogs") {
      data = await getBlogs();
    } else if (action === "add") {
      if (!appProjectId || !projectId) {
        return new Response(
          JSON.stringify({
            error:
              "Missing required parameters 'appProjectId' and 'projectId' for add action",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Add project schemas to database
      const { data: addSchemas, error: addSchemasError } = await supabaseClient
        .from("project_schemas")
        .insert({
          sanity_project_id: projectId,
          sanity_dataset: dataset,
          sanity_pages: pages,
          sanity_components: components,
          sanity_global_seo: globalSeo,
          app_project_id: appProjectId,
        })
        .select()
        .single();

      if (addSchemasError) {
        throw new Error(
          "Failed to add project schemas: " + addSchemasError.message,
        );
      }

      data = addSchemas;
    } else if (action === "retrieve") {
      if (!projectId) {
        return new Response(
          JSON.stringify({
            error: "Missing required parameter 'projectId' for retrieve action",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: currentSchemas, error: retrieveSchemasError } =
        await supabaseClient
          .from("project_schemas")
          .select(
            "id, app_project_id, sanity_pages, sanity_components, sanity_global_seo",
          )
          .eq("app_project_id", projectId)
          .order("created_at", { ascending: false });

      if (retrieveSchemasError) {
        throw new Error(
          "Failed to retrieve project schemas: " + retrieveSchemasError.message,
        );
      }

      data = currentSchemas;
    } else {
      return new Response(
        JSON.stringify({
          error:
            "Invalid action. Valid actions: add, retrieve, get_authors, get_categories, get_blogs",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Schemas API Error:", error);
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
