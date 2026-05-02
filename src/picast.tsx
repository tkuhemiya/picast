import { useEffect, useState } from "react";
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
} from "@raycast/api";
import { useForm } from "@raycast/utils";
import { getConfig, mergeConfig, validateConfig } from "../lib/config";
import { createPIClient } from "../lib/pi-client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;
}

interface ChatFormValues {
  prompt: string;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentModel, setCurrentModel] = useState<string>("auto");
  const [searchText, setSearchText] = useState("");

  // Load config on mount
  const [config, setConfig] = useState(() => {
    const detected = getConfig("auto");
    return mergeConfig(detected, {});
  });

  // Load conversation history from storage (optional)
  useEffect(() => {
    // Could load from Storage here
  }, []);

  const { handleSubmit, itemProps } = useForm<ChatFormValues>({
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

  async function sendMessage(prompt: string) {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setSearchText("");

    // Add user message
    const userMessage: ChatMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const piClient = createPIClient(config);
      
      // Prepare conversation history (limit to context window)
      const contextWindow = 10; // Could be from preferences
      const conversationHistory = messages
        .slice(-contextWindow)
        .map((m) => ({ role: m.role, content: m.content }));

      // Send request
      const response = await piClient.chat({
        model: currentModel !== "auto" ? currentModel : undefined,
        messages: [
          ...conversationHistory,
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      });

      // Extract response
      const assistantContent =
        response.choices?.[0]?.message?.content ||
        response.choices?.[0]?.text ||
        "No response received";

      // Add assistant message
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: response.model,
      };
      setMessages((prev) => [...prev, assistantMessage]);

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
    } finally {
      setIsLoading(false);
    }
  }

  async function regenerateLastMessage() {
    if (messages.length === 0) return;

    // Find last user message
    const lastUserMessageIndex = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserMessageIndex === -1) return;

    const lastUserMessage = messages[lastUserMessageIndex];

    // Remove last assistant message if it exists
    let newMessages = [...messages];
    if (
      lastUserMessageIndex < messages.length - 1 &&
      messages[lastUserMessageIndex + 1].role === "assistant"
    ) {
      newMessages = messages.slice(0, lastUserMessageIndex + 1);
    }

    setMessages(newMessages);
    await sendMessage(lastUserMessage.content);
  }

  async function clearChat() {
    const confirmed = await confirmAlert({
      title: "Clear Conversation",
      message: "Are you sure you want to clear the entire conversation?",
      icon: Icon.Trash,
    });

    if (confirmed) {
      setMessages([]);
      await showToast({
        style: Toast.Style.Success,
        title: "Conversation cleared",
      });
    }
  }

  function copyMessage(content: string) {
    Clipboard.copy(content);
    showToast({
      style: Toast.Style.Success,
      title: "Copied to clipboard",
    });
  }

  return (
    <List
      isLoading={isLoading && messages.length === 0}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      navigationTitle="PI Agent"
      searchBarPlaceholder="Ask PI anything..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Select Model"
          value={currentModel}
          onChange={setCurrentModel}
        >
          <List.Dropdown.Item value="auto" title="Auto-detect" />
          <List.Dropdown.Item value="pi-chat" title="PI Chat" />
          <List.Dropdown.Item value="pi-code" title="PI Code" />
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section title="Chat Actions">
            <Action
              title="Send Message"
              icon={Icon.Message}
              shortcut={{ modifiers: ["ctrl"], key: "enter" }}
              onAction={() => {
                if (searchText.trim()) {
                  sendMessage(searchText);
                }
              }}
            />
            <Action
              title="Regenerate Response"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={regenerateLastMessage}
            />
            <Action
              title="Clear Conversation"
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
              onAction={clearChat}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Configuration">
            <Action.Push
              icon={Icon.Gear}
              title="Configure PI"
              target={<ConfigureCommand />}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      {messages.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Robot}
          title="Start a Conversation"
          description="Ask PI anything. Type your message above and press Enter."
          actions={
            <ActionPanel>
              <Action
                title="Quick Question"
                icon={Icon.Bolt}
                onAction={() => {
                  const questions = [
                    "Explain quantum computing in simple terms",
                    "What's the best way to learn TypeScript?",
                    "How do I optimize React performance?",
                  ];
                  sendMessage(
                    questions[Math.floor(Math.random() * questions.length)]
                  );
                }}
              />
            </ActionPanel>
          }
        />
      ) : (
        messages.map((message, index) => (
          <List.Item
            key={index}
            icon={
              message.role === "user" ? Icon.Person : Icon.Robot
            }
            title={message.content}
            subtitle={
              message.role === "user"
                ? "You"
                : message.model || "PI"
            }
            accessories={[
              {
                date: new Date(message.timestamp),
                tooltip: new Date(message.timestamp).toLocaleString(),
              },
              ...(message.role === "assistant"
                ? [
                    {
                      text: message.model || "PI",
                      color: Color.Purple,
                    },
                  ]
                : []),
            ]}
            actions={
              <ActionPanel>
                <ActionPanel.Section title="Message Actions">
                  <Action
                    icon={Icon.Clipboard}
                    title="Copy Message"
                    onAction={() => copyMessage(message.content)}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                  {message.role === "assistant" && (
                    <>
                      <Action
                        icon={Icon.ArrowClockwise}
                        title="Regenerate"
                        onAction={regenerateLastMessage}
                      />
                      <Action
                        icon={Icon.Download}
                        title="Save to File"
                        onAction={async () => {
                          await Clipboard.copy(message.content);
                          await showToast({
                            style: Toast.Style.Success,
                            title: "Saved to clipboard",
                          });
                        }}
                      />
                    </>
                  )}
                </ActionPanel.Section>
              </ActionPanel>
            }
            detail={
              <List.Item.Detail
                markdown={message.content}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title="Role"
                      text={message.role === "user" ? "You" : "PI Assistant"}
                    />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label
                      title="Time"
                      text={new Date(message.timestamp).toLocaleString()}
                    />
                    {message.role === "assistant" && message.model && (
                      <>
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label
                          title="Model"
                          text={message.model}
                        />
                      </>
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
          />
        ))
      )}

      {/* Inline form for quick message input */}
      {searchText && (
        <List.Item
          title={`Send: "${searchText.substring(0, 50)}${searchText.length > 50 ? "..." : ""}"`}
          icon={Icon.ArrowRight}
          actions={
            <ActionPanel>
              <Action
                title="Send"
                icon={Icon.Message}
                onAction={() => sendMessage(searchText)}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}

// Placeholder for Configure command - will be implemented separately
function ConfigureCommand() {
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" onSubmit={() => {}} />
        </ActionPanel>
      }
    >
      <Form.Description text="Configuration screen - see configure.tsx" />
    </Form>
  );
}
