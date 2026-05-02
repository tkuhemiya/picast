import { useEffect, useState } from "react";
import { Action, ActionPanel, Color, Icon, List, showToast, Toast, Clipboard } from "@raycast/api";
import { StoredChatMessage, loadMessages, saveMessages, chat } from "./lib";

export default function ChatInterface() {
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const saved = await loadMessages();
      setMessages(saved);
      if (saved.length > 0) {
        setSelectedId(String(saved.length - 1));
      }
      setIsInitializing(false);
    }
    init();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  async function sendMessage(prompt: string) {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setSearchText("");

    const userMessage: StoredChatMessage = {
      id: createMessageId(),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    console.log("[picast] sending message", {
      promptLength: prompt.length,
      messageCount: newMessages.length,
    });

    try {
      const conversationHistory = [
        {
          role: "system" as const,
          content:
            "You are PI, a concise and helpful assistant inside a Raycast extension. Answer clearly and directly.",
        },
        ...newMessages.slice(-20).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      console.log("[picast] conversation history", conversationHistory);
      const response = await chat({
        messages: conversationHistory,
        temperature: 0.7,
      });
      console.log("[picast] chat response", response);

      const choice = response.choices?.[0];
      const assistantContent = choice?.message?.content ?? choice?.text ?? "No response received";

      const assistantMessage: StoredChatMessage = {
        id: createMessageId(),
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: response.model,
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      await saveMessages(finalMessages);

      setSelectedId(String(finalMessages.length - 1));

      await showToast({ style: Toast.Style.Success, title: "Response received" });
    } catch (error) {
      console.error("[picast] Chat error:", error);
      console.error("[picast] Chat error stack:", error instanceof Error ? error.stack : undefined);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to get response",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      setMessages(newMessages);
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

  const hasSearchText = searchText.trim().length > 0;

  return (
    <List
      filtering={false}
      isLoading={isInitializing || isLoading}
      isShowingDetail={true}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      selectedItemId={selectedId ?? undefined}
      onSelectionChange={(id) => setSelectedId(id)}
      navigationTitle="PI Chat"
      searchBarPlaceholder="Type a message and press Enter..."
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Send">
            {hasSearchText && (
              <Action title="Send Message" icon={Icon.Message} onAction={() => sendMessage(searchText)} />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {hasSearchText && (
        <List.Item
          key="__send__"
          id="__send__"
          title={`↵  Send: "${searchText.slice(0, 60)}${searchText.length > 60 ? "..." : ""}"`}
          icon={{ source: Icon.Message, tintColor: Color.Green }}
          accessories={[{ text: "Press Enter", icon: Icon.ArrowRight }]}
          detail={<List.Item.Detail markdown={`Send message:\n\n${searchText}`} />}
          actions={
            <ActionPanel>
              <Action title="Send Message" icon={Icon.Message} onAction={() => sendMessage(searchText)} />
            </ActionPanel>
          }
        />
      )}

      {messages.length === 0 && !isLoading && !hasSearchText ? (
        <List.EmptyView
          icon={Icon.SpeechBubble}
          title="Start a Conversation"
          description="Type below and press Enter to send.\n↑↓ to browse messages."
        />
      ) : (
        [...messages].reverse().map((message, revIndex) => {
          const originalIndex = messages.length - 1 - revIndex;
          const isAssistant = message.role === "assistant";
          const icon = isAssistant ? { source: Icon.SpeechBubble, tintColor: Color.Purple } : Icon.Person;
          const title = isAssistant ? "PI" : "You";
          const preview = message.content.length > 80 ? message.content.slice(0, 80) + "..." : message.content;

          return (
            <List.Item
              key={String(originalIndex)}
              id={String(originalIndex)}
              icon={icon}
              title={title}
              subtitle={preview}
              accessories={[
                {
                  date: new Date(message.timestamp),
                  tooltip: new Date(message.timestamp).toLocaleString(),
                },
                ...(isAssistant && message.model
                  ? [
                      {
                        text: {
                          value: message.model.split("/").pop() || message.model,
                          color: Color.Purple,
                        },
                      },
                    ]
                  : []),
              ]}
              detail={<List.Item.Detail markdown={formatMessageForMarkdown(message)} />}
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
                        const trimmed = messages.filter((_, i) => i !== originalIndex);
                        setMessages(trimmed);
                        saveMessages(trimmed);
                      }}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section>
                    <Action
                      icon={Icon.Trash}
                      title="Delete All Messages"
                      style={Action.Style.Destructive}
                      onAction={() => {
                        setMessages([]);
                        saveMessages([]);
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

function createMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMessageForMarkdown(message: StoredChatMessage): string {
  if (message.role === "user") {
    return `> **You**\n> \n> ${message.content.replace(/\n/g, "\n> ")}`;
  }
  return message.content;
}
