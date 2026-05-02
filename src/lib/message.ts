import { LocalStorage } from "@raycast/api";

const MESSAGES_KEY = "picast-messages";

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;
}

function loadJsonFile<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadMessages(): Promise<StoredChatMessage[]> {
  const raw = await LocalStorage.getItem<string>(MESSAGES_KEY);
  return loadJsonFile(raw, []);
}

export async function saveMessages(messages: StoredChatMessage[]) {
  await LocalStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

export async function clearMessages() {
  await LocalStorage.removeItem(MESSAGES_KEY);
}
