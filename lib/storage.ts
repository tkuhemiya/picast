import { LocalStorage } from "@raycast/api";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  model?: string;
}

export interface ChatSession {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;
}

const SESSIONS_KEY = "picast-sessions";
const ACTIVE_SESSION_KEY = "picast-active-session";

/**
 * Get all saved sessions
 */
export async function getSessions(): Promise<ChatSession[]> {
  const data = await LocalStorage.getItem<string>(SESSIONS_KEY);
  if (!data) return [];
  try {
    const sessions = JSON.parse(data) as ChatSession[];
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Save all sessions
 */
export async function saveSessions(sessions: ChatSession[]): Promise<void> {
  await LocalStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/**
 * Get the last active session ID
 */
export async function getActiveSessionId(): Promise<string | null> {
  return LocalStorage.getItem<string>(ACTIVE_SESSION_KEY) || null;
}

/**
 * Set the active session ID
 */
export async function setActiveSessionId(id: string | null): Promise<void> {
  if (id) {
    await LocalStorage.setItem(ACTIVE_SESSION_KEY, id);
  } else {
    await LocalStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

/**
 * Create a new session
 */
export async function createSession(name?: string, model?: string): Promise<ChatSession> {
  const sessions = await getSessions();
  const session: ChatSession = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name || `Chat ${sessions.length + 1}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model,
  };
  sessions.unshift(session);
  await saveSessions(sessions);
  await setActiveSessionId(session.id);
  return session;
}

/**
 * Get a session by ID
 */
export async function getSession(id: string): Promise<ChatSession | null> {
  const sessions = await getSessions();
  return sessions.find((s) => s.id === id) || null;
}

/**
 * Update a session (replace messages, update timestamp)
 */
export async function updateSession(id: string, updates: Partial<ChatSession>): Promise<void> {
  const sessions = await getSessions();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return;
  sessions[index] = { ...sessions[index], ...updates, updatedAt: Date.now() };
  await saveSessions(sessions);
}

/**
 * Add a message to a session
 */
export async function addMessage(sessionId: string, message: ChatMessage): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  session.messages.push(message);
  session.updatedAt = Date.now();
  await updateSession(sessionId, { messages: session.messages, updatedAt: session.updatedAt });
}

/**
 * Delete a session
 */
export async function deleteSession(id: string): Promise<void> {
  const sessions = await getSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  await saveSessions(filtered);

  const activeId = await getActiveSessionId();
  if (activeId === id) {
    await setActiveSessionId(filtered[0]?.id || null);
  }
}

/**
 * Rename a session
 */
export async function renameSession(id: string, name: string): Promise<void> {
  await updateSession(id, { name });
}

/**
 * Auto-generate session name from first user message
 */
export function generateSessionName(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "New Chat";
  // Take first 5 words or 40 chars
  const words = trimmed.split(/\s+/).slice(0, 5).join(" ");
  if (words.length > 40) return words.slice(0, 40) + "...";
  return words;
}
