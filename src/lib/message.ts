import { LocalStorage } from "@raycast/api";

const MESSAGES_KEY = "picast-messages";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;
}

export async function loadMessages(): Promise<ChatMessage[]> {
  const raw = await LocalStorage.getItem<string>(MESSAGES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveMessages(messages: ChatMessage[]) {
  await LocalStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

export async function clearMessages() {
  await LocalStorage.removeItem(MESSAGES_KEY);
}