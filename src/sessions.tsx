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
  useNavigation,
} from "@raycast/api";
import {
  getSessions,
  deleteSession,
  renameSession,
  createSession,
  setActiveSessionId,
  type ChatSession,
} from "../lib/storage";

export default function SessionsManager() {
  const { push } = useNavigation();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setIsLoading(true);
    const all = await getSessions();
    setSessions(all);
    setIsLoading(false);
  }

  async function handleDelete(session: ChatSession) {
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
      await deleteSession(session.id);
      await loadSessions();
      await showToast({ style: Toast.Style.Success, title: "Chat deleted" });
    }
  }

  async function handleRename(session: ChatSession) {
    push(
      <RenameView
        session={session}
        onRename={async (newName) => {
          await renameSession(session.id, newName);
          await loadSessions();
          await showToast({ style: Toast.Style.Success, title: "Renamed" });
        }}
      />
    );
  }

  async function handleNewChat() {
    const session = await createSession();
    await setActiveSessionId(session.id);
    await loadSessions();
    await showToast({ style: Toast.Style.Success, title: "New chat created" });
  }

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      navigationTitle="Chat Sessions"
      searchBarPlaceholder="Search sessions..."
      actions={
        <ActionPanel>
          <Action title="New Chat" icon={Icon.Plus} shortcut={{ modifiers: ["cmd"], key: "n" }} onAction={handleNewChat} />
          <Action title="Refresh" icon={Icon.ArrowClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={loadSessions} />
        </ActionPanel>
      }
    >
      {filtered.length === 0 ? (
        <List.EmptyView
          icon={Icon.Message}
          title="No Sessions"
          description="Start a new chat to create your first session."
          actions={
            <ActionPanel>
              <Action title="New Chat" icon={Icon.Plus} onAction={handleNewChat} />
            </ActionPanel>
          }
        />
      ) : (
        filtered.map((session) => {
          const msgCount = session.messages.length;
          const lastMessage = session.messages[msgCount - 1];
          const subtitle = lastMessage
            ? `${lastMessage.role === "user" ? "You" : "PI"}: ${lastMessage.content.slice(0, 60)}${lastMessage.content.length > 60 ? "..." : ""}`
            : "No messages yet";

          return (
            <List.Item
              key={session.id}
              icon={{ source: Icon.Message, tintColor: Color.Blue }}
              title={session.name}
              subtitle={subtitle}
              accessories={[
                { text: `${msgCount} message${msgCount !== 1 ? "s" : ""}` },
                { date: new Date(session.updatedAt), tooltip: new Date(session.updatedAt).toLocaleString() },
              ]}
              actions={
                <ActionPanel>
                  <ActionPanel.Section title="Open">
                    <Action
                      title="Open Chat"
                      icon={Icon.ArrowRight}
                      onAction={async () => {
                        await setActiveSessionId(session.id);
                        await showToast({ style: Toast.Style.Success, title: `Opened ${session.name}` });
                      }}
                    />
                  </ActionPanel.Section>
                  <ActionPanel.Section title="Manage">
                    <Action
                      title="Rename"
                      icon={Icon.Pencil}
                      shortcut={{ modifiers: ["cmd"], key: "e" }}
                      onAction={() => handleRename(session)}
                    />
                    <Action
                      title="Delete"
                      icon={Icon.Trash}
                      shortcut={{ modifiers: ["cmd"], key: "delete" }}
                      style={Action.Style.Destructive}
                      onAction={() => handleDelete(session)}
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

function RenameView({
  session,
  onRename,
}: {
  session: ChatSession;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(session.name);
  const { pop } = useNavigation();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save"
            onSubmit={async () => {
              if (name.trim()) {
                await onRename(name.trim());
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Chat Name" value={name} onChange={setName} />
    </Form>
  );
}
