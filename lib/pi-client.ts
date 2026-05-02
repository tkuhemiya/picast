import { exec } from "child_process";
import { promisify } from "util";
import { PIConfig } from "./config";

const execAsync = promisify(exec);

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
 * PI API Client using pi CLI
 */
export class PIClient {
  private config: PIConfig;

  constructor(config: PIConfig) {
    this.config = config;
  }

  /**
   * Build the prompt from conversation history
   */
  private buildPrompt(messages: ChatMessage[]): string {
    return messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  }

  /**
   * Send chat request using pi CLI
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = this.buildPrompt(request.messages);
    
    // Build pi CLI command
    let command = `pi -p ${this.escapeShell(prompt)}`;
    
    // Add model if specified
    if (request.model) {
      command = `pi --model ${this.escapeShell(request.model)} -p ${this.escapeShell(prompt)}`;
    }
    
    // Add thinking level if configured via temperature
    if (request.temperature !== undefined) {
      const thinkingLevel = this.temperatureToThinking(request.temperature);
      if (thinkingLevel) {
        command = command.replace("-p", `--thinking ${thinkingLevel} -p`);
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 120000, // 2 minute timeout
      });

      if (stderr && !stderr.includes("[DEP0040]")) {
        console.warn("pi CLI stderr:", stderr);
      }

      return {
        model: request.model || "pi",
        choices: [{
          message: {
            role: "assistant",
            content: stdout.trim(),
          },
        }],
      };
    } catch (error) {
      const execError = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        `pi CLI Error: ${execError.message}${execError.stderr ? " - " + execError.stderr : ""}`
      );
    }
  }

  /**
   * Convert temperature to pi thinking level
   */
  private temperatureToThinking(temp: number): string | null {
    if (temp <= 0.3) return "low";
    if (temp <= 0.5) return "minimal";
    if (temp <= 0.7) return "medium";
    if (temp <= 0.9) return "high";
    return "xhigh";
  }

  /**
   * Escape shell argument
   */
  private escapeShell(arg: string): string {
    return `'${arg.replace(/'/g, "'\"'\"'")}'`;
  }

  /**
   * Streaming not supported with pi CLI (use non-streaming instead)
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    // Fallback to non-streaming chat
    const response = await this.chat(request);
    const content = response.choices?.[0]?.message?.content || "";
    yield content;
  }

  /**
   * Test connection to pi CLI
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { stdout } = await execAsync("pi --version", {
        timeout: 5000,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "pi CLI not found",
      };
    }
  }

  /**
   * Get available models (not supported by pi CLI)
   */
  async getModels(): Promise<string[]> {
    // pi CLI doesn't expose a models list via CLI
    return ["pi", "sonnet", "gpt-4o", "gemini"];
  }
}

/**
 * Create PI client from config
 */
export function createPIClient(config: PIConfig): PIClient {
  return new PIClient(config);
}
