import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { PDFExtract } from "https://esm.sh/pdf.js-extract@0.1.4";
import { Buffer } from "node:buffer";
import * as base64 from "https://deno.land/std@0.192.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new Error("Missing auth token");
    }
    const token = authHeader.split(" ")[1];
    if (token !== Deno.env.get("SERVICE_AUTH_TOKEN")) {
      throw new Error("Invalid token");
    }

    // Process request
    const { file, text, userInfo, fileName } = await req.json();

    if ((!file && !text) || !userInfo) {
      throw new Error("Missing required parameters");
    }

    // Initialize services
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      throw new Error("Missing OpenAI API key");
    }

    // Handle PDF processing
    if (file) {
      const pdfData = base64.decode(file);
      const pdfExtract = new PDFExtract();
      const data = await pdfExtract.extractBuffer(Buffer.from(pdfData));

      let pageNumber = 1;
      for (const page of data.pages) {
        const pageText = page.content
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (pageText.length > 50) { // Skip empty/almost empty pages
          await processTextChunk(
            apiKey,
            pageText,
            supabase,
            userInfo,
            fileName,
            pageNumber,
          );
        }
        pageNumber++;
      }
    }

    // Handle direct text processing
    if (text) {
      await processTextChunk(
        apiKey,
        text,
        supabase,
        userInfo,
        "user-input",
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

async function processTextChunk(
  apiKey: string,
  text: string,
  supabase: SupabaseClient,
  userInfo: string,
  source: string,
  pageNumber?: number,
) {
  // Split text into chunks (simplified version)
  const chunkSize = 1000;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }

  // Process each chunk
  for (const chunk of chunks) {
    // Generate query embedding
    const embeddingReq = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-ada-002",
        input: chunk,
      }),
    });

    if (!embeddingReq.ok) {
      throw new Error(
        `OpenAI Embeddings API error: ${embeddingReq.status} ${await embeddingReq
          .text()}`,
      );
    }

    const embedding = await embeddingReq.json();
    const embeddingRes = embedding.data[0].embedding;

    const { error } = await supabase.from("chat_summary").insert({
      content: chunk,
      embeddingRes,
      user_info: userInfo,
      metadata: {
        type: source === "user-input" ? "text" : "pdf",
        source,
        page: pageNumber,
      },
    });

    if (error) throw error;
  }
}
