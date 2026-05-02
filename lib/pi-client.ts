import { 
  getModel, 
  completeSimple,
  streamSimple,
  type Model,
  type AssistantMessage,
} from "@mariozechner/pi-ai";
import fs from "fs";
import path from "path";
import os from "os";
import { PIConfig } from "./config";

/**
 * Get pi's agent directory
 */
function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

/**
 * Read pi's auth.json to get credentials
 */
function readAuthStorage(): Record<string, any> {
  const authPath = path.join(getAgentDir(), "auth.json");
  try {
    if (fs.existsSync(authPath)) {
      const content = fs.readFileSync(authPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Failed to read auth.json:", error);
  }
  return {};
}

/**
 * Read pi's settings.json for defaults
 */
function readSettings(): Record<string, any> {
  const settingsPath = path.join(getAgentDir(), "settings.json");
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Failed to read settings.json:", error);
  }
  return {};
}

/**
 * Get credentials for a provider from auth storage
 */
function getProviderCredentials(providerId: string, authStorage: Record<string, any>): any {
  return authStorage[providerId];
}

/**
 * Create a model instance using pi-ai with credentials from pi's auth.json
 */
function createModel(config: PIConfig, authStorage: Record<string, any>): Model<any> {
  // Determine provider/model from config
  const modelId = config.defaultModel || "auto";
  
  // Parse provider/model from modelId (format: "provider/model" or just model name)
  let provider: string;
  let model: string;
  
  if (modelId.includes("/")) {
    const parts = modelId.split("/");
    provider = parts[0];
    model = parts[1];
  } else if (modelId === "auto") {
    // Use pi's default provider/model from settings
    const settings = readSettings();
    const defaultProvider = settings.defaultProvider || "opencode-go";
    const defaultModel = settings.defaultModel || "qwen3.5-plus";
    provider = defaultProvider;
    model = defaultModel;
  } else {
    // Default to opencode-go if no provider specified
    provider = "opencode-go";
    model = modelId;
  }
  
  // Get credentials for this provider
  const credentials = getProviderCredentials(provider, authStorage);
  
  // Build model options based on credential type
  let modelOptions: any = {};
  
  if (credentials) {
    if (credentials.type === "oauth") {
      // OAuth credentials (GitHub Copilot, OpenAI Codex, etc.)
      modelOptions = {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
      };
    } else if (credentials.type === "api_key") {
      // API key credentials
      modelOptions = {
        apiKey: credentials.key,
      };
    }
  }
  
  // Create and return the model
  return getModel(provider, model, modelOptions);
}

/**
 * Chat message structure
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
 * Convert pi-ai AssistantMessage to our ChatResponse format
 */
function convertResponse(message: AssistantMessage): ChatResponse {
  // Extract text content from the message
  const textContent = message.content
    .filter(c => c.type === "text")
    .map(c => (c as any).text)
    .join("");
  
  return {
    id: message.responseId,
    model: message.model,
    choices: [{
      message: {
        role: "assistant",
        content: textContent,
      },
      finish_reason: message.stopReason,
    }],
    usage: {
      prompt_tokens: message.usage.input,
      completion_tokens: message.usage.output,
      total_tokens: message.usage.totalTokens,
    },
  };
}

/**
 * PI API Client using @mariozechner/pi-ai
 */
export class PIClient {
  private config: PIConfig;
  private authStorage: Record<string, any>;
  private settings: Record<string, any>;

  constructor(config: PIConfig) {
    this.config = config;
    this.authStorage = readAuthStorage();
    this.settings = readSettings();
  }

  /**
   * Build conversation context for pi-ai
   */
  private buildContext(request: ChatRequest) {
    // Convert our message format to pi-ai format
    const messages = request.messages.map(m => ({
      role: m.role,
      content: [{ type: "text" as const, text: m.content }],
      timestamp: Date.now(),
    }));
    
    return {
      messages,
    };
  }

  /**
   * Send chat request using pi-ai
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const context = this.buildContext(request);
    
    // Determine model to use
    const modelId = request.model && request.model !== "auto" ? request.model : undefined;
    const configWithModel = modelId ? { ...this.config, defaultModel: modelId } : this.config;
    
    // Create model instance with credentials
    const model = createModel(configWithModel, this.authStorage);
    
    try {
      const message = await completeSimple(model, context, {
        temperature: request.temperature,
        maxTokens: request.max_tokens,
      });
      
      return convertResponse(message);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`pi-ai Error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Send streaming chat request using pi-ai
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    const context = this.buildContext(request);
    
    // Determine model to use
    const modelId = request.model && request.model !== "auto" ? request.model : undefined;
    const configWithModel = modelId ? { ...this.config, defaultModel: modelId } : this.config;
    
    // Create model instance with credentials
    const model = createModel(configWithModel, this.authStorage);
    
    try {
      const stream = streamSimple(model, context, {
        temperature: request.temperature,
      });
      
      // Process stream events
      for await (const event of stream) {
        if (event.type === "text_delta" && event.delta) {
          yield event.delta;
        } else if (event.type === "error") {
          throw new Error(event.error.errorMessage || "Stream error");
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`pi-ai Stream Error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Test connection by checking auth files exist
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const agentDir = getAgentDir();
    
    // Check if agent directory exists
    if (!fs.existsSync(agentDir)) {
      return {
        success: false,
        error: `pi agent directory not found: ${agentDir}. Run 'pi' CLI first to initialize.`,
      };
    }
    
    // Check if auth.json exists
    const authPath = path.join(agentDir, "auth.json");
    if (!fs.existsSync(authPath)) {
      return {
        success: false,
        error: "auth.json not found. Configure providers in pi CLI first.",
      };
    }
    
    // Check if we have at least one provider configured
    const authStorage = this.authStorage;
    const providers = Object.keys(authStorage);
    if (providers.length === 0) {
      return {
        success: false,
        error: "No providers configured in auth.json. Run 'pi' CLI to authenticate.",
      };
    }
    
    return { success: true };
  }

  /**
   * Get available models from settings and auth
   */
  async getModels(): Promise<string[]> {
    const models: string[] = [];
    
    // Add default model from settings
    if (this.settings.defaultModel) {
      const provider = this.settings.defaultProvider || "opencode-go";
      models.push(`${provider}/${this.settings.defaultModel}`);
    }
    
    // Add models from authenticated providers
    const providers = Object.keys(this.authStorage);
    for (const provider of providers) {
      // Common models for each provider type
      if (provider.includes("github") || provider.includes("copilot")) {
        models.push("github-copilot/gpt-5.4-mini", "github-copilot/gpt-5.4");
      } else if (provider.includes("openai")) {
        models.push("openai-codex/gpt-4o", "openai-codex/o3");
      } else if (provider.includes("opencode")) {
        models.push("opencode-go/qwen3.5-plus", "opencode-go/qwen3.5");
      } else if (provider.includes("anthropic")) {
        models.push("anthropic/claude-sonnet-4", "anthropic/claude-opus-4");
      } else if (provider.includes("google") || provider.includes("gemini")) {
        models.push("google/gemini-2.5-pro", "google/gemini-2.0-flash");
      }
    }
    
    // Remove duplicates and return
    return [...new Set(models)];
  }
}

/**
 * Create PI client from config
 */
export function createPIClient(config: PIConfig): PIClient {
  return new PIClient(config);
}
