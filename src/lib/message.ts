import { LocalStorage } from "@raycast/api";

const CONVERSATIONS_KEY = "picast-conversations";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;
  error?: string;
}

export interface StoredChatConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredChatMessage[];
}

function loadJsonFile<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadConversations(): Promise<StoredChatConversation[]> {
  const raw = await LocalStorage.getItem<string>(CONVERSATIONS_KEY);
  return loadJsonFile(raw!, []);
}

export async function saveConversations(conversations: StoredChatConversation[]) {
  await LocalStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
}

export async function clearConversations() {
  await LocalStorage.removeItem(CONVERSATIONS_KEY);
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createNewConversation(title = "New Chat"): StoredChatConversation {
  const now = Date.now();
  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function updateConversationTitle(conversation: StoredChatConversation): StoredChatConversation {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  const title = firstUser?.content.trim().slice(0, 40) || conversation.title || "New Chat";
  return { ...conversation, title };
}
