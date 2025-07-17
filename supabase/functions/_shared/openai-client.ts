import { OpenAIEmbeddingResponse, OpenAIMessage } from "../_shared/types.ts";

const apiKey = Deno.env.get("OPENAI_API_KEY")!;

export class OpenAIClient {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.openai.com/v1";
  }

  async createChatCompletion(
    messages: OpenAIMessage[],
    stream = false,
    tools: any[] | undefined = undefined,
    tool_choice: string | undefined = undefined,
  ): Promise<Response> {
    const body: any = {
      model: "gpt-4.1-mini",
      messages,
      stream,
      temperature: 0.7,
      max_tokens: 2000,
    };

    if (tools) {
      body.tools = tools;
    }
    if (tool_choice) {
      body.tool_choice = tool_choice;
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    return response;
  }

  async createEmbedding(input: string): Promise<number[]> {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: OpenAIEmbeddingResponse = await response.json();
    return data.data[0].embedding;
  }

  async *streamChatCompletion(
    messages: OpenAIMessage[],
  ): AsyncGenerator<string, void, unknown> {
    const response = await this.createChatCompletion(messages, true);

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (e) {
              // Skip invalid JSON
              console.error("Error parsing JSON: ", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error streaming chat completion: ", error);
    } finally {
      reader.releaseLock();
    }
  }
}

export const openaiClient = new OpenAIClient(apiKey);
