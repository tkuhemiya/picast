import { useEffect, useMemo, useState } from "react";
import { Action, ActionPanel, Color, Icon, List, showToast, Toast, Clipboard } from "@raycast/api";
import {
  StoredChatConversation,
  StoredChatMessage,
  chat,
  createId,
  createNewConversation,
  loadConversations,
  saveConversations,
  updateConversationTitle,
} from "./lib";

export default function ChatInterface() {
  const [conversations, setConversations] = useState<StoredChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [viewConversationId, setViewConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    async function init() {
      const saved = await loadConversations();
      setConversations(saved);
      const firstConversationId = saved[0]?.id ?? null;
      setActiveConversationId(firstConversationId);
      setViewConversationId(firstConversationId);
      setIsInitializing(false);
    }

    init();
  }, []);

  useEffect(() => {
    if (isInitializing) return;
    void saveConversations(conversations);
  }, [conversations, isInitializing]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );

  const chatList = conversations;
  const hasDraft = searchText.trim().length > 0;

  function createConversation(force = false) {
    if (!force && !searchText.trim()) return;

    const conversation = createNewConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
    setViewConversationId(conversation.id);
    return conversation.id;
  }

  function upsertConversation(updatedConversation: StoredChatConversation) {
    setConversations((current) => {
      const exists = current.some((conversation) => conversation.id === updatedConversation.id);
      return exists
        ? current.map((conversation) =>
            conversation.id === updatedConversation.id ? updatedConversation : conversation,
          )
        : [updatedConversation, ...current];
    });
  }

  async function sendMessage(prompt: string, conversationIdInput?: string) {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    const targetConversation =
      conversations.find((conversation) => conversation.id === conversationIdInput) ?? activeConversation ?? null;
    const conversation = targetConversation ?? createNewConversation();
    const now = Date.now();

    if (!targetConversation && !activeConversation) {
      setConversations((current) => [conversation, ...current]);
    }

    const userMessage: StoredChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      timestamp: now,
    };

    const conversationWithUser = updateConversationTitle({
      ...conversation,
      messages: [...conversation.messages, userMessage],
      updatedAt: now,
      title: conversation.messages.length === 0 ? trimmed.slice(0, 40) || "New Chat" : conversation.title,
    });

    setActiveConversationId(conversation.id);
    upsertConversation(conversationWithUser);
    setSearchText("");
    setIsLoading(true);

    try {
      const response = await chat({
        messages: conversationWithUser.messages.slice(-20).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      const choice = response.choices?.[0];
      const assistantContent = choice?.message?.content ?? choice?.text ?? "No response received";
      const assistantMessage: StoredChatMessage = {
        id: `${userMessage.id}-assistant`,
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: response.model,
      };

      const nextConversation = updateConversationTitle({
        ...conversationWithUser,
        messages: [...conversationWithUser.messages, assistantMessage],
        updatedAt: assistantMessage.timestamp,
      });
      upsertConversation(nextConversation);
      await showToast({ style: Toast.Style.Success, title: "Response received" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const failedMessage: StoredChatMessage = {
        id: `${userMessage.id}-error`,
        role: "assistant",
        content: "Request failed",
        timestamp: Date.now(),
        error: errorMessage,
      };
      const nextConversation = {
        ...conversationWithUser,
        messages: [...conversationWithUser.messages, failedMessage],
        updatedAt: failedMessage.timestamp,
      };
      upsertConversation(nextConversation);
      await showToast({ style: Toast.Style.Failure, title: "Request failed", message: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }

  function copyMessage(content: string) {
    Clipboard.copy(content);
    showToast({ style: Toast.Style.Success, title: "Copied to clipboard" });
  }

  const viewedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === viewConversationId) ?? null,
    [conversations, viewConversationId],
  );

  const detailMarkdown = viewedConversation ? formatConversationMarkdown(viewedConversation.messages) : null;

  return (
    <List
      filtering={false}
      isLoading={isInitializing || isLoading}
      isShowingDetail={true}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      selectedItemId={viewConversationId ?? undefined}
      onSelectionChange={(id) => setViewConversationId(id)}
      navigationTitle="PI Chat"
      searchBarPlaceholder="Type a message and press Enter..."
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Chats">
            <Action title="New" icon={Icon.Plus} onAction={() => createConversation(true)} />
          </ActionPanel.Section>
          <ActionPanel.Section title="Send">
            {hasDraft && activeConversation && (
              <Action
                title="Send Message"
                icon={Icon.Message}
                onAction={() => void sendMessage(searchText, activeConversation.id)}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {chatList.length === 0 ? (
        <List.EmptyView
          icon={Icon.SpeechBubble}
          title="Start a Conversation"
          description="Create a new chat to begin."
        />
      ) : (
        chatList.map((conversation) => {
          const preview = conversation.messages.find((message) => message.role === "user")?.content ?? "New Chat";
          const active = conversation.id === activeConversationId;
          const viewed = conversation.id === viewConversationId;
          const lastMessage = conversation.messages.at(-1);
          return (
            <List.Item
              key={conversation.id}
              id={conversation.id}
              title={conversation.title}
              subtitle={preview.length > 120 ? `${preview.slice(0, 120)}...` : preview}
              accessories={[
                { date: new Date(conversation.updatedAt), tooltip: new Date(conversation.updatedAt).toLocaleString() },
                ...(lastMessage?.error ? [{ text: "Error", icon: Icon.Exclamationmark2 }] : []),
                ...(active ? [{ text: "Active", icon: Icon.Dot }] : []),
                ...(viewed && !active ? [{ text: "View", icon: Icon.Eye }] : []),
              ]}
              icon={{ source: Icon.SpeechBubble, tintColor: active ? Color.Green : viewed ? Color.Blue : Color.Purple }}
              detail={
                <List.Item.Detail
                  markdown={
                    detailMarkdown ?? "# No conversation selected\n\nCreate a new chat or select one from the list."
                  }
                />
              }
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    {hasDraft && (
                      <Action
                        title="Send Message"
                        icon={Icon.Message}
                        onAction={() => void sendMessage(searchText, conversation.id)}
                      />
                    )}
                    <Action title="+ New" icon={Icon.Plus} onAction={() => createConversation(true)} />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      title="Copy Conversation"
                      icon={Icon.Clipboard}
                      shortcut={{ modifiers: ["cmd"], key: "c" }}
                      onAction={() => copyMessage(formatConversationClipboard(conversation.messages))}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      title="Delete Chat"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => {
                        const next = conversations.filter((item) => item.id !== conversation.id);
                        setConversations(next);
                        void saveConversations(next);
                        if (activeConversationId === conversation.id) {
                          setActiveConversationId(null);
                        }
                      }}
                    />
                    <Action
                      title="Delete All Messages"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => {
                        setConversations([]);
                        setActiveConversationId(null);
                        void saveConversations([]);
                      }}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function formatConversationMarkdown(messages: StoredChatMessage[]): string {
  return messages
    .map((message) => {
      const role = message.role === "user" ? "You" : "PI";
      const error = message.error ? `\n\n⚠️ **Error:** ${message.error}` : "";
      return `### ${role}\n\n${message.content}${error}`;
    })
    .join("\n\n---\n\n");
}

function formatConversationClipboard(messages: StoredChatMessage[]): string {
  return messages.map((message) => `${message.role === "user" ? "You" : "PI"}: ${message.content}`).join("\n\n");
}
