import { useEffect, useState } from "react";
import {
  Action,
  ActionPanel,
  Alert,
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
import {
  ChatMessage,
  clearMessages,
  loadMessages,
  saveMessages,
  chat,
} from "./lib";

export default function ChatInterface() {
  const { push, pop } = useNavigation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load messages on mount
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

  // Persist whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  async function handleDeleteConversation() {
    const confirmed = await confirmAlert({
      title: "Delete Conversation",
      message: "This will permanently delete all messages. Are you sure?",
      icon: Icon.Trash,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });

    if (confirmed) {
      setMessages([]);
      setSelectedId(null);
      await clearMessages();
      await showToast({ style: Toast.Style.Success, title: "Conversation deleted" });
    }
  }

  async function sendMessage(prompt: string) {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setSearchText("");

    const userMessage: ChatMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    try {
      const conversationHistory = newMessages.slice(-20).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await chat({
        messages: conversationHistory,
        temperature: 0.7,
      });

      const choice = response.choices?.[0];
      const assistantContent =
        choice?.message?.content ?? choice?.text ?? "No response received";

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: response.model,
      };

      const finalMessages = [...newMessages, assistantMessage];
      setMessages(finalMessages);
      await saveMessages(finalMessages);

      // Auto-select the new response
      setSelectedId(String(finalMessages.length - 1));

      await showToast({ style: Toast.Style.Success, title: "Response received" });
    } catch (error) {
      console.error("Chat error:", error);
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

  function openComposeForm(prefill = "") {
    push(
      <ComposeForm
        prefill={prefill}
        onSend={async (text) => {
          await sendMessage(text);
          pop();
        }}
        onCancel={pop}
      />,
    );
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
              <Action
                title="Send Message"
                icon={Icon.Message}
                onAction={() => sendMessage(searchText)}
              />
            )}
            <Action
              title="Compose Message"
              icon={Icon.Text}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              onAction={() => openComposeForm(searchText)}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Chat">
            <Action
              title="Regenerate Response"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={regenerateLastMessage}
            />
            <Action
              title="Copy Full Conversation"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              onAction={() => {
                const fullText = messages
                  .map((m) => `**${m.role === "user" ? "You" : "PI"}**: ${m.content}`)
                  .join("\n\n");
                Clipboard.copy(fullText);
                showToast({ style: Toast.Style.Success, title: "Conversation copied" });
              }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Session">
            <Action
              title="Delete Conversation"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
              style={Action.Style.Destructive}
              onAction={handleDeleteConversation}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {/* When typing, show Send action FIRST so Enter hits it immediately */}
      {hasSearchText && (
        <List.Item
          id="__send__"
          title={`↵  Send: "${searchText.slice(0, 60)}${searchText.length > 60 ? "..." : ""}"`}
          icon={{ source: Icon.Message, tintColor: Color.Green }}
          accessories={[{ text: "Press Enter", icon: Icon.ArrowRight }]}
          detail={<List.Item.Detail markdown={`Send message:\n\n${searchText}`} />}
          actions={
            <ActionPanel>
              <Action
                title="Send Message"
                icon={Icon.Message}
                onAction={() => sendMessage(searchText)}
              />
              <Action
                title="Compose in Editor"
                icon={Icon.Text}
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                onAction={() => openComposeForm(searchText)}
              />
            </ActionPanel>
          }
        />
      )}

      {/* Messages — newest first so recent messages are near the search bar */}
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
          const icon = isAssistant
            ? { source: Icon.SpeechBubble, tintColor: Color.Purple }
            : Icon.Person;
          const title = isAssistant ? "PI" : "You";
          const preview =
            message.content.length > 80
              ? message.content.slice(0, 80) + "..."
              : message.content;

          return (
            <List.Item
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
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function ComposeForm({
  prefill,
  onSend,
  onCancel,
}: {
  prefill: string;
  onSend: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(prefill);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Message"
            icon={Icon.Message}
            onSubmit={async () => {
              if (text.trim()) {
                await onSend(text.trim());
              }
            }}
          />
          <Action title="Cancel" icon={Icon.Xmark} onAction={onCancel} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="message"
        title="Message"
        placeholder="Type your message here..."
        value={text}
        onChange={setText}
      />
    </Form>
  );
}

function formatMessageForMarkdown(message: ChatMessage): string {
  if (message.role === "user") {
    return `> **You**\n> \n> ${message.content.replace(/\n/g, "\n> ")}`;
  }
  return message.content;
}
