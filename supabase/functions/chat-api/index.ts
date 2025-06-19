import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { OpenAI } from "https://esm.sh/openai@4.0.0";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

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
    const { sessionId, messages } = await req.json();
    if (
      !sessionId || !messages || !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing or invalid parameters: sessionId and messages are required.",
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

    // Get chat session
    const { data: session, error: sessionError } = await supabaseClient
      .from("chat_sessions")
      .select("threads")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) {
      return new Response(
        JSON.stringify({ error: `Session with ID ${sessionId} not found.` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const history: ChatMessage[] = session.threads || [];
    const fullThread: ChatMessage[] = [...history, ...messages];

    // Retrieve relevant knowledge
    const { data: knowledge } = await supabaseClient
      .from("knowledge_base")
      .select("content")
      .eq("session_id", sessionId);

    const context = knowledge?.map((k: { content: string }) =>
      k.content
    ).join("\n\n") || "";

    // Generate AI response
    const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            `You are a helpful AI assistant for our company dedicated to generating AI-ready content. If the context doesn't contain relevant information, say so politely and ask for more specific info or suggest uploading relevant documents.
            
            ROLE AND PURPOSE: Assist users in generating content guided by LLM-readiness best practices using the provided context and user's question.
            
            TONE: Professional, conversational, and helpful — never robotic or overly verbose.

            RESPONSE STRUCTURE:
            - Briefly acknowledge the user's question (1-2 sentences max)
            - If context is provided, always start response with: 'Here's an enhanced version of the content: '
            - If user asks for a summary, provide a brief summary of the content
            - If user asks for enhancement or review on content, provide a summary and list of needed changes (if any)
            - If user asks to include external sources, provide a list of sources and their URLs at the end of the response
            - If user asks out-of-scope actions, politely decline specifying your role and suggest in-scope actions to generate AI-ready content
            - Always end response with a question: 'What do you wish to do next?'
            
            CRITICAL BEHAVIOR RULES:
            - Do not generate content that is offensive, inappropriate, spam or irrelevant to the context.
            - Use plain text formatting (no markdown)
            - Do not repeat the same content multiple times
            - Do not ask out-of-scope questions
            
            Context:\n${context}
          `,
        },
        ...fullThread,
      ],
      temperature: 0.95,
    });

    const aiResponseContent = completion.choices[0].message.content;

    if (!aiResponseContent) {
      throw new Error("OpenAI returned an empty response.");
    }

    const aiResponse: ChatMessage = {
      role: "assistant",
      content: aiResponseContent,
    };

    const finalThreads = [...fullThread, aiResponse];

    // Save user message and AI response together
    await supabaseClient
      .from("chat_sessions")
      .update({ threads: finalThreads })
      .eq("id", sessionId);

    return new Response(JSON.stringify({ response: finalThreads }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
