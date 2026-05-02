import { readFileSync } from "fs";
import {
  getModel,
  completeSimple,
  streamSimple,
  type AssistantMessage,
  type Context,
  type Message,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";

const SETTINGS_PATH = "/Users/themiya/.pi/agent/settings.json";
const AUTH_PATH = "/Users/themiya/.pi/agent/auth.json";
const DEBUG = process.env.NODE_ENV !== "production" || process.env.PI_DEBUG === "1";

function debugLog(message: string, data?: unknown) {
  if (!DEBUG) return;
  if (data === undefined) {
    console.log(`[picast] ${message}`);
  } else {
    console.log(`[picast] ${message}`, data);
  }
}

function debugError(label: string, error: unknown) {
  if (!DEBUG) return;
  if (error instanceof Error) {
    console.error(`[picast] ${label}`, error.message, error.stack);
  } else {
    console.error(`[picast] ${label}`, error);
  }
}

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

function loadJsonFile<T>(path: string, fallback: T): T {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as T;
    debugLog(`Loaded JSON file: ${path}`);
    return parsed;
  } catch (error) {
    debugError(`Failed to load JSON file: ${path}`, error);
    return fallback;
  }
}

const settings = loadJsonFile<PiSettings>(SETTINGS_PATH, {});
const auth = loadJsonFile<AuthConfig>(AUTH_PATH, {});

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

function parseModelId(modelString: string): { provider: string; model: string } {
  if (modelString.includes("/")) {
    const [provider, model] = modelString.split("/");
    return { provider, model };
  }

  return {
    provider: settings.defaultProvider || "opencode-go",
    model: modelString,
  };
}

function getModelFromString(modelString: string) {
  const { provider, model } = parseModelId(modelString);
  return getModel(provider as never, model as never);
}

function convertResponse(message: AssistantMessage): ChatResponse {
  const textContent = message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
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

function buildContext(messages: ChatMessage[]): Context {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");
  const timestamp = Date.now();

  const contextMessages: Message[] = otherMessages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
    timestamp,
  }));

  const context: Context = { messages: contextMessages };

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

function resolveChatConfig(request: ChatRequest) {
  const modelId = resolveModel(request.model);
  const { provider } = parseModelId(modelId);
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    debugLog(`Missing API key for provider: ${provider}`);
    throw new Error(`No API key found for provider "${provider}" in ${AUTH_PATH}`);
  }

  return {
    model: getModelFromString(modelId),
    context: buildContext(request.messages),
    apiKey,
  };
}

function getReasoningLevel(): SimpleStreamOptions["reasoning"] {
  return settings.defaultThinkingLevel as SimpleStreamOptions["reasoning"];
}

export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const { model, context, apiKey } = resolveChatConfig(request);

  debugLog("Starting completeSimple request");
  let message: AssistantMessage;
  try {
    message = await completeSimple(model, context, {
      maxTokens: request.max_tokens,
      apiKey,
      reasoning: getReasoningLevel(),
    });
  } catch (error) {
    debugError("completeSimple threw", error);
    throw error;
  }

  if (message.stopReason === "error" || message.errorMessage) {
    debugLog("completeSimple returned error", {
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    });
    throw new Error(message.errorMessage || "Unknown API error");
  }

  debugLog("completeSimple completed successfully", {
    responseId: message.responseId,
    model: message.model,
  });
  return convertResponse(message);
}

export async function* chatStream(request: ChatRequest): AsyncGenerator<string> {
  const { model, context, apiKey } = resolveChatConfig(request);

  debugLog("Starting streamSimple request");
  let stream;
  try {
    stream = streamSimple(model, context, {
      apiKey,
      reasoning: getReasoningLevel(),
    });
  } catch (error) {
    debugError("streamSimple threw", error);
    throw error;
  }

  for await (const event of stream) {
    if (event.type === "text_delta" && event.delta) {
      debugLog("stream text delta", { deltaLength: event.delta.length });
      yield event.delta;
    } else if (event.type === "error") {
      debugLog("stream error event", event.error);
      throw new Error(event.error.errorMessage || "Stream error");
    }
  }
}
