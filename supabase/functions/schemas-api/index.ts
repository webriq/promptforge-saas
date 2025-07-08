import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { storeKnowledgeBase } from "../_shared/rag-utils.ts";

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
    } = await req.json();
    if (!action || !projectId || !appProjectId) {
      return new Response(
        JSON.stringify({
          error:
            "Missing required parameters 'action', 'projectId' or 'appProjectId'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action !== "add" && action !== "retrieve") {
      return new Response(
        JSON.stringify({
          error: "Invalid action. Should be 'add' or 'retrieve'",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let data;
    if (action === "add") {
      // Add project schemas to database
      const { data: addSchemas, error: addSchemasError } = await supabaseClient
        .from("project_schemas")
        .insert({
          sanity_project_id: parseInt(projectId) || null,
          sanity_project_dataset: dataset,
          sanity_pages: pages,
          sanity_components: components,
          sanity_global_seo: globalSeo,
          app_project_id: appProjectId,
        })
        .select()
        .single();

      if (addSchemasError) {
        throw new Error("Failed to add project schemas: " + addSchemasError.message);
      }

      // Store schema data in knowledge base for RAG context
      try {
        // Store pages data
        if (pages && pages.result && pages.result.length > 0) {
          const pagesContent = pages.result.map((page: any) => 
            `Page: ${page.title || page._type}\nType: ${page._type}\nContent: ${JSON.stringify(page, null, 2)}`
          ).join('\n\n');
          
          await storeKnowledgeBase(
            appProjectId,
            null, // No specific session for schema data
            pagesContent,
            {
              type: "schema_pages",
              sanity_project_id: projectId,
              dataset: dataset,
              count: pages.result.length,
              synced_at: new Date().toISOString(),
            }
          );
        }

        // Store components data
        if (components && components.result && components.result.length > 0) {
          const componentsContent = components.result.map((component: any) => 
            `Component: ${component.title || component._type}\nType: ${component._type}\nContent: ${JSON.stringify(component, null, 2)}`
          ).join('\n\n');
          
          await storeKnowledgeBase(
            appProjectId,
            null, // No specific session for schema data
            componentsContent,
            {
              type: "schema_components",
              sanity_project_id: projectId,
              dataset: dataset,
              count: components.result.length,
              synced_at: new Date().toISOString(),
            }
          );
        }

        // Store globalSeo data
        if (globalSeo && globalSeo.result && globalSeo.result.length > 0) {
          const globalSeoContent = globalSeo.result.map((seo: any) => 
            `Global SEO: ${seo.title || seo._type}\nType: ${seo._type}\nContent: ${JSON.stringify(seo, null, 2)}`
          ).join('\n\n');
          
          await storeKnowledgeBase(
            appProjectId,
            null, // No specific session for schema data
            globalSeoContent,
            {
              type: "schema_global_seo",
              sanity_project_id: projectId,
              dataset: dataset,
              count: globalSeo.result.length,
              synced_at: new Date().toISOString(),
            }
          );
        }

        console.log(`Successfully stored schema data in knowledge base for project ${appProjectId}`);
      } catch (knowledgeError) {
        console.error("Failed to store schema data in knowledge base:", knowledgeError);
        // Don't fail the whole request if knowledge storage fails
      }

      data = addSchemas;
    }

    if (action === "retrieve") {
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
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
