import { readFileSync } from "fs";
import {
  getModel,
  completeSimple,
  streamSimple,
  type AssistantMessage,
} from "@mariozechner/pi-ai";

const SETTINGS_PATH = "/Users/themiya/.pi/agent/settings.json";
const AUTH_PATH = "/Users/themiya/.pi/agent/auth.json";

interface PiSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

interface AuthEntry {
  type: "api_key";
  key: string;
}

interface OAuthEntry {
  type: "oauth";
  access: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
}

type AuthConfig = Record<string, AuthEntry | OAuthEntry>;

function loadSettings(): PiSettings {
  try {
    const raw = readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadAuth(): AuthConfig {
  try {
    const raw = readFileSync(AUTH_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const settings = loadSettings();
const auth = loadAuth();

function getApiKey(provider: string): string | undefined {
  const entry = auth[provider];
  if (!entry) return undefined;

  if (entry.type === "api_key") {
    return entry.key;
  }

  if (entry.type === "oauth") {
    return entry.access;
  }

  return undefined;
}

function getModelFromString(modelString: string) {
  const [provider, model] = modelString.includes("/")
    ? modelString.split("/")
    : [settings.defaultProvider || "opencode-go", modelString];
  return getModel(provider as any, model as any);
}

function convertResponse(message: AssistantMessage): ChatResponse {
  const textContent = message.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("");

  return {
    id: message.responseId,
    model: message.model,
    choices: [
      {
        message: { role: "assistant", content: textContent },
        finish_reason: message.stopReason,
      },
    ],
    usage: {
      prompt_tokens: message.usage.input,
      completion_tokens: message.usage.output,
      total_tokens: message.usage.totalTokens,
    },
  };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
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

function buildContext(messages: ChatMessage[]): any {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  const context: any = {
    messages: otherMessages.map((m) => ({
      role: m.role,
      content: [{ type: "text" as const, text: m.content }],
      timestamp: Date.now(),
    })),
  };

  if (systemMessages.length > 0) {
    context.systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
  }

  return context;
}

function resolveModel(requestModel?: string): string {
  if (requestModel && requestModel !== "auto") return requestModel;
  if (settings.defaultProvider && settings.defaultModel) {
    return `${settings.defaultProvider}/${settings.defaultModel}`;
  }
  return "opencode-go/qwen3.5-plus";
}

export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const modelId = resolveModel(request.model);
  const provider = modelId.includes("/") ? modelId.split("/")[0] : "opencode-go";
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    throw new Error(`No API key found for provider "${provider}" in ${AUTH_PATH}`);
  }
  const model = getModelFromString(modelId);
  const context = buildContext(request.messages);

  const message = await completeSimple(model, context, {
    temperature: request.temperature,
    maxTokens: request.max_tokens,
    apiKey,
    reasoning: settings.defaultThinkingLevel as any,
  });

  if (message.stopReason === "error" || message.errorMessage) {
    throw new Error(message.errorMessage || "Unknown API error");
  }

  return convertResponse(message);
}

export async function* chatStream(
  request: ChatRequest
): AsyncGenerator<string> {
  const modelId = resolveModel(request.model);
  const provider = modelId.includes("/") ? modelId.split("/")[0] : "opencode-go";
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    throw new Error(`No API key found for provider "${provider}" in ${AUTH_PATH}`);
  }
  const model = getModelFromString(modelId);
  const context = buildContext(request.messages);

  const stream = streamSimple(model, context, {
    temperature: request.temperature,
    apiKey,
    reasoning: settings.defaultThinkingLevel as any,
  });

  for await (const event of stream) {
    if (event.type === "text_delta" && event.delta) {
      yield event.delta;
    } else if (event.type === "error") {
      throw new Error(event.error.errorMessage || "Stream error");
    }
  }
}
