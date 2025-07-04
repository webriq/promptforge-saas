import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
        throw new Error("Failed to add project schemas: ", addSchemasError);
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
          "Failed to retrieve project schemas: ",
          retrieveSchemasError,
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
