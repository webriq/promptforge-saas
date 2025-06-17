import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { messages, userId, history_id } = await req.json();
    const query = messages[messages.length - 1]?.content;
    if (!query) throw new Error("No query provided");
    if (!history_id) throw new Error("No history_id provided");

    // Initialize services
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      throw new Error("Missing OpenAI API key");
    }

    // Generate query embedding
    const embeddingReq = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-ada-002",
        input: query,
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

    // Retrieve relevant documents (filter by user)
    const { data: documents, error } = await supabase.rpc(
      "match_chat_summary",
      {
        query_embedding: embeddingRes,
        match_threshold: 0.7,
        match_count: 5,
        user_id: userId,
      },
    );

    if (error) throw error;

    // Prepare context
    const context = (documents as Array<{ metadata: any; content: string }>)
      .map((d) => `Source: ${d.metadata.source}\nContent: ${d.content}`)
      .join("\n\n---\n\n");

    // Generate response with enhanced prompt
    const prompt = `
You are an AI chat assistant for our company, dedicated to provide exceptional support for new content generation, fact checking and summarization. 
Use the following context to answer the question. If uncertain, admit it briefly and ask a clarifying question.

Context:
${context}

Conversation history:
${
      messages.slice(0, -1).map((m: { role: string; content: string }) =>
        `${m.role}: ${m.content}`
      ).join("\n")
    }

Question: ${query}
Answer:`.trim();

    const completion = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: prompt }],
          response_format: {
            type: "json_object",
          },
          store: false,
        }),
      },
    );

    if (!completion.ok) {
      throw new Error(
        `OpenAI API error: ${completion.status} ${await completion.text()}`,
      );
    }

    const response = await completion.json();
    const answer = response.choices[0].message.content || "";

    // Store summary with history_id
    const { error: summaryError } = await supabase
      .from("chat_summary")
      .insert({
        content: answer,
        chat_history_id: history_id,
      });
    if (summaryError) {
      throw new Error("Failed to save chat summary: " + summaryError.message);
    }

    return new Response(
      JSON.stringify({
        answer,
        sources: (documents as Array<{ metadata: any }>).map((d) => d.metadata),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
