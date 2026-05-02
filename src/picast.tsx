import { useEffect, useState, useCallback } from "react";
import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  List,
  confirmAlert,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
} from "@raycast/api";
import { useForm } from "@raycast/utils";
import { getConfig, mergeConfig } from "../lib/config";
import { createPIClient } from "../lib/pi-client";
import ConfigureCommand from "./configure";
import {
  getSessions,
  getActiveSessionId,
  setActiveSessionId,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  renameSession,
  generateSessionName,
  type ChatMessage,
  type ChatSession,
} from "../lib/storage";

interface ChatFormValues {
  prompt: string;
}

export default function ChatInterface() {
  const { push } = useNavigation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>("auto");
  const [searchText, setSearchText] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  // Load config
  const config = mergeConfig(getConfig("auto"), {});

  // Initialize: load sessions and auto-restore last active
  useEffect(() => {
    async function init() {
      const allSessions = await getSessions();
      setSessions(allSessions);

      const activeId = await getActiveSessionId();
      if (activeId) {
        const session = await getSession(activeId);
        if (session) {
          setCurrentSessionId(session.id);
          setMessages(session.messages);
          if (session.model) setCurrentModel(session.model);
        } else {
          // Session was deleted, create new
          const newSession = await createSession();
          setCurrentSessionId(newSession.id);
          setSessions((prev) => [newSession, ...prev]);
        }
      } else if (allSessions.length > 0) {
        // No active session but sessions exist - load most recent
        const mostRecent = allSessions[0];
        setCurrentSessionId(mostRecent.id);
        setMessages(mostRecent.messages);
        await setActiveSessionId(mostRecent.id);
      } else {
        // No sessions at all - create first session
        const newSession = await createSession();
        setCurrentSessionId(newSession.id);
        setSessions([newSession]);
      }
      setIsInitializing(false);
    }
    init();
  }, []);

  // Save messages to storage whenever they change
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      updateSession(currentSessionId, { messages });
      // Also update session name if this is the first user message
      getSession(currentSessionId).then((session) => {
        if (session && session.name.startsWith("Chat ") && messages.length >= 1) {
          const firstUser = messages.find((m) => m.role === "user");
          if (firstUser) {
            const newName = generateSessionName(firstUser.content);
            renameSession(currentSessionId, newName);
            setSessions((prev) =>
              prev.map((s) => (s.id === currentSessionId ? { ...s, name: newName } : s))
            );
          }
        }
      });
    }
  }, [messages, currentSessionId]);

  const { handleSubmit } = useForm<ChatFormValues>({
    validation: {
      prompt: (value) => {
        if (!value || value.trim().length === 0) {
          return "Please enter a message";
        }
        return undefined;
      },
    },
    onSubmit: async (values) => {
      await sendMessage(values.prompt);
    },
  });

  async function refreshSessions() {
    const all = await getSessions();
    setSessions(all);
  }

  async function switchSession(sessionId: string) {
    if (sessionId === "__new__") {
      await handleNewSession();
      return;
    }
    const session = await getSession(sessionId);
    if (session) {
      setCurrentSessionId(session.id);
      setMessages(session.messages);
      await setActiveSessionId(session.id);
    }
  }

  async function handleNewSession() {
    const newSession = await createSession(undefined, currentModel !== "auto" ? currentModel : undefined);
    setCurrentSessionId(newSession.id);
    setMessages([]);
    setSessions((prev) => [newSession, ...prev]);
    await refreshSessions();
    await showToast({ style: Toast.Style.Success, title: "New chat started" });
  }

  async function handleDeleteSession(sessionId: string) {
    const session = await getSession(sessionId);
    if (!session) return;

    const confirmed = await confirmAlert({
      title: "Delete Chat",
      message: `Delete "${session.name}"? This cannot be undone.`,
      icon: Icon.Trash,
      primaryAction: {
        title: "Delete",
        style: Action.Style.Destructive,
      },
    });

    if (confirmed) {
      await deleteSession(sessionId);
      await refreshSessions();

      if (currentSessionId === sessionId) {
        const remaining = await getSessions();
        if (remaining.length > 0) {
          await switchSession(remaining[0].id);
        } else {
          const newSession = await createSession();
          setCurrentSessionId(newSession.id);
          setMessages([]);
          setSessions([newSession]);
        }
      }

      await showToast({ style: Toast.Style.Success, title: "Chat deleted" });
    }
  }

  async function handleClearChat() {
    if (!currentSessionId) return;
    const confirmed = await confirmAlert({
      title: "Clear Conversation",
      message: "Clear all messages in this chat? The chat itself will be kept.",
      icon: Icon.Trash,
    });

    if (confirmed) {
      setMessages([]);
      await updateSession(currentSessionId, { messages: [] });
      await showToast({ style: Toast.Style.Success, title: "Conversation cleared" });
    }
  }

  async function sendMessage(prompt: string) {
    if (!prompt.trim() || !currentSessionId) return;

    setIsLoading(true);
    setSearchText("");

    // Ensure we have a session
    let sessionId = currentSessionId;
    if (!sessionId) {
      const newSession = await createSession();
      sessionId = newSession.id;
      setCurrentSessionId(sessionId);
      setSessions((prev) => [newSession, ...prev]);
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    try {
      const piClient = createPIClient(config);
      const connectionTest = await piClient.testConnection();
      if (!connectionTest.success) {
        throw new Error(connectionTest.error || "Connection failed");
      }

      const conversationHistory = newMessages
        .slice(-20) // Context window of 20 messages
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await piClient.chat({
        model: currentModel !== "auto" ? currentModel : undefined,
        messages: conversationHistory,
        temperature: 0.7,
      });

      const assistantContent =
        response.choices?.[0]?.message?.content ||
        response.choices?.[0]?.text ||
        "No response received";

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: response.model,
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      await updateSession(sessionId, { messages: finalMessages });

      await showToast({
        style: Toast.Style.Success,
        title: "Response received",
      });
    } catch (error) {
      console.error("Chat error:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to get response",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setMessages(newMessages); // Keep user message even on error
    } finally {
      setIsLoading(false);
    }
  }

  async function regenerateLastMessage() {
    if (messages.length === 0) return;
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex === -1) return;

    const lastUserMessage = messages[lastUserIndex];
    const trimmedMessages = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmedMessages);
    await sendMessage(lastUserMessage.content);
  }

  function copyMessage(content: string) {
    Clipboard.copy(content);
    showToast({ style: Toast.Style.Success, title: "Copied to clipboard" });
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <List
      isLoading={isInitializing || (isLoading && messages.length === 0)}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      navigationTitle={currentSession ? currentSession.name : "PI Agent"}
      searchBarPlaceholder="Ask PI anything... (Ctrl+Enter to send)"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Chat Session"
          value={currentSessionId || "__new__"}
          onChange={switchSession}
        >
          <List.Dropdown.Item value="__new__" title="➕ New Chat" icon={Icon.Plus} />
          <List.Dropdown.Section title="Recent Chats">
            {sessions.map((session) => (
              <List.Dropdown.Item
                key={session.id}
                value={session.id}
                title={session.name}
                icon={Icon.Message}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Chat">
            <Action
              title="Send Message"
              icon={Icon.Message}
              shortcut={{ modifiers: ["ctrl"], key: "enter" }}
              onAction={() => {
                if (searchText.trim()) sendMessage(searchText);
              }}
            />
            <Action
              title="New Chat"
              icon={Icon.Plus}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
              onAction={handleNewSession}
            />
            <Action
              title="Regenerate Response"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={regenerateLastMessage}
            />
            <Action
              title="Clear Conversation"
              icon={Icon.Eraser}
              shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
              onAction={handleClearChat}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Session">
            <Action
              title="Delete Current Chat"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
              style={Action.Style.Destructive}
              onAction={() => currentSessionId && handleDeleteSession(currentSessionId)}
            />
            <Action
              title="Copy Full Conversation"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              onAction={() => {
                const fullText = messages.map((m) => `**${m.role === "user" ? "You" : "PI"}**: ${m.content}`).join("\n\n");
                Clipboard.copy(fullText);
                showToast({ style: Toast.Style.Success, title: "Conversation copied" });
              }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Settings">
            <Action.Push icon={Icon.Gear} title="Configure PI" target={<ConfigureCommand />} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {messages.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Robot}
          title="Start a Conversation"
          description={`Session: ${currentSession?.name || "New Chat"}\nType a message and press Ctrl+Enter to send.`}
          actions={
            <ActionPanel>
              <Action
                title="New Chat"
                icon={Icon.Plus}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
                onAction={handleNewSession}
              />
            </ActionPanel>
          }
        />
      ) : (
        messages.map((message, index) => {
          const isAssistant = message.role === "assistant";
          const icon = isAssistant ? { source: Icon.Robot, tintColor: Color.Purple } : Icon.Person;
          const title = isAssistant ? "PI" : "You";
          const preview = message.content.length > 80 ? message.content.slice(0, 80) + "..." : message.content;

          return (
            <List.Item
              key={index}
              icon={icon}
              title={title}
              subtitle={preview}
              accessories={[
                {
                  date: new Date(message.timestamp),
                  tooltip: new Date(message.timestamp).toLocaleString(),
                },
                ...(isAssistant && message.model
                  ? [{ text: message.model.split("/").pop() || message.model, color: Color.Purple }]
                  : []),
              ]}
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    <Action
                      icon={Icon.Clipboard}
                      title="Copy Message"
                      shortcut={{ modifiers: ["cmd"], key: "c" }}
                      onAction={() => copyMessage(message.content)}
                    />
                    {isAssistant && (
                      <Action
                        icon={Icon.ArrowClockwise}
                        title="Regenerate"
                        shortcut={{ modifiers: ["cmd"], key: "r" }}
                        onAction={regenerateLastMessage}
                      />
                    )}
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      icon={Icon.Trash}
                      title="Delete Message"
                      style={Action.Style.Destructive}
                      onAction={() => {
                        const trimmed = messages.filter((_, i) => i !== index);
                        setMessages(trimmed);
                        if (currentSessionId) updateSession(currentSessionId, { messages: trimmed });
                      }}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
              detail={
                <List.Item.Detail
                  markdown={formatMessageForMarkdown(message)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="From" text={isAssistant ? "PI Assistant" : "You"} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label
                        title="Time"
                        text={new Date(message.timestamp).toLocaleString()}
                      />
                      {isAssistant && message.model && (
                        <>
                          <List.Item.Detail.Metadata.Separator />
                          <List.Item.Detail.Metadata.Label title="Model" text={message.model} />
                        </>
                      )}
                    </List.Item.Detail.Metadata>
                  }
                />
              }
            />
          );
        })
      )}

      {/* Send action from search text */}
      {searchText.trim() && (
        <List.Item
          title={`Send: "${searchText.slice(0, 50)}${searchText.length > 50 ? "..." : ""}"`}
          icon={Icon.ArrowRight}
          actions={
            <ActionPanel>
              <Action title="Send" icon={Icon.Message} onAction={() => sendMessage(searchText)} />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

/**
 * Format a message for markdown rendering in Raycast Detail view.
 * Wraps user messages in a quote block, renders assistant messages as-is.
 */
function formatMessageForMarkdown(message: ChatMessage): string {
  if (message.role === "user") {
    return `> **You**\n> \n> ${message.content.replace(/\n/g, "\n> ")}`;
  }
  return message.content;
}


