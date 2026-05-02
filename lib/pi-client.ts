import fetch from "node-fetch";
import { PIConfig } from "./config";

/**
 * Message structure for chat
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Chat request payload
 */
export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  stream?: boolean;
  max_tokens?: number;
}

/**
 * Chat response structure
 */
export interface ChatResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: ChatMessage;
    finish_reason?: string;
    text?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Error response
 */
export interface PIError {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * PI API Client
 */
export class PIClient {
  private config: PIConfig;
  private baseUrl: string;

  constructor(config: PIConfig) {
    this.config = config;
    this.baseUrl = `${this.getProtocol()}://${config.host}:${config.port}`;
  }

  private getProtocol(): string {
    // Could be extended to support HTTPS
    return "http";
  }

  /**
   * Get full API URL
   */
  private getApiUrl(endpoint?: string): string {
    return `${this.baseUrl}${endpoint || this.config.endpoint || "/api/v1/chat"}`;
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * Send chat request
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = this.getApiUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: request.messages,
        temperature: request.temperature,
        stream: false,
        max_tokens: request.max_tokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `PI API Error: ${response.status} ${response.statusText} - ${
          errorData.error?.message || "Unknown error"
        }`
      );
    }

    return response.json() as Promise<ChatResponse>;
  }

  /**
   * Send streaming chat request
   * Returns an async iterable that yields response chunks
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    const url = this.getApiUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: request.model || this.config.defaultModel,
        messages: request.messages,
        temperature: request.temperature,
        stream: true,
        max_tokens: request.max_tokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `PI API Error: ${response.status} ${response.statusText} - ${
          errorData.error?.message || "Unknown error"
        }`
      );
    }

    const body = response.body;
    if (!body) {
      throw new Error("No response body");
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content =
                parsed.choices?.[0]?.text ||
                parsed.choices?.[0]?.delta?.content ||
                "";
              if (content) {
                yield content;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Test connection to PI server
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try a simple health check or models endpoint
      const url = `${this.baseUrl}/api/v1/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (response.ok) {
        return { success: true };
      }

      // If models endpoint doesn't exist, try chat with empty message
      const chatUrl = this.getApiUrl();
      const chatResponse = await fetch(chatUrl, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.defaultModel || "test",
          messages: [{ role: "user", content: "test" }],
          stream: false,
        }),
      });

      if (chatResponse.ok) {
        return { success: true };
      }

      const errorData = await chatResponse.json().catch(() => ({}));
      return {
        success: false,
        error: `Connection failed: ${chatResponse.status} - ${errorData.error?.message || "Unknown error"}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }

  /**
   * Get available models (if endpoint supports it)
   */
  async getModels(): Promise<string[]> {
    try {
      const url = `${this.baseUrl}/api/v1/models`;
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        // Adapt based on actual API response format
        if (Array.isArray(data.data)) {
          return data.data.map((m: any) => m.id || m.name);
        }
        if (Array.isArray(data.models)) {
          return data.models.map((m: any) => m.id || m.name);
        }
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
    return [];
  }
}

/**
 * Create PI client from config
 */
export function createPIClient(config: PIConfig): PIClient {
  return new PIClient(config);
}
