import { useState, useEffect } from "react";
import {
  Action,
  ActionPanel,
  Form,
  Icon,
  showToast,
  Toast,
  popToRoot,
} from "@raycast/api";
import { getPreferenceValues, updatePreferences } from "@raycast/api";
import { getConfig, validateConfig, mergeConfig } from "../lib/config";
import { createPIClient } from "../lib/pi-client";

interface Preferences {
  configSource: string;
  host: string;
  port: string;
  apiKey: string;
  model: string;
  temperature: string;
  streamResponses: boolean;
}

export default function ConfigureCommand() {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Load current preferences
  const preferences = getPreferenceValues<Preferences>();

  // Load detected config for display
  const [detectedConfig, setDetectedConfig] = useState(() => {
    try {
      const detected = getConfig(preferences.configSource || "auto");
      return mergeConfig(detected, preferences);
    } catch (error) {
      return getConfig("auto");
    }
  });

  async function handleSubmit(values: Preferences) {
    try {
      // Validate configuration
      const config = mergeConfig(getConfig(values.configSource), values);
      const validation = validateConfig(config);

      if (!validation.valid) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Invalid Configuration",
          message: validation.error,
        });
        return;
      }

      // Update preferences
      await updatePreferences(values);

      await showToast({
        style: Toast.Style.Success,
        title: "Configuration Saved",
        message: "Your PI settings have been updated",
      });

      popToRoot();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Save",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function testConnection() {
    setIsTesting(true);
    setTestResult(null);

    try {
      const config = mergeConfig(getConfig(preferences.configSource), {
        host: preferences.host,
        port: preferences.port,
        apiKey: preferences.apiKey,
      });

      const client = createPIClient(config);
      const result = await client.testConnection();

      setTestResult({
        success: result.success,
        message: result.success
          ? "Successfully connected to PI server!"
          : result.error || "Connection failed",
      });

      await showToast({
        style: result.success ? Toast.Style.Success : Toast.Style.Failure,
        title: result.success ? "Connection Successful" : "Connection Failed",
        message: result.message,
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      });

      await showToast({
        style: Toast.Style.Failure,
        title: "Connection Failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function resetToDefaults() {
    await updatePreferences({
      configSource: "auto",
      host: "localhost",
      port: "11434",
      apiKey: "",
      model: "auto",
      temperature: "0.7",
      streamResponses: true,
    });

    await showToast({
      style: Toast.Style.Success,
      title: "Reset to Defaults",
      message: "Configuration has been reset",
    });

    setDetectedConfig(getConfig("auto"));
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Configuration" onSubmit={handleSubmit} />
          <ActionPanel.Section title="Testing">
            <Action
              icon={Icon.Bolt}
              title={isTesting ? "Testing..." : "Test Connection"}
              onAction={testConnection}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              isLoading={isTesting}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Actions">
            <Action
              icon={Icon.ArrowCounterClockwise}
              title="Reset to Defaults"
              onAction={resetToDefaults}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.Description
        title="PI Agent Configuration"
        text="Configure your local PI instance. The extension will auto-detect your existing PI setup when possible."
      />

      <Form.Separator />

      <Form.Dropdown
        id="configSource"
        title="Configuration Source"
        defaultValue={preferences.configSource || "auto"}
        info="Where to load PI configuration from"
      >
        <Form.Dropdown.Item value="auto" title="Auto-detect (Recommended)" />
        <Form.Dropdown.Item
          value="file"
          title="PI Config File (~/.picast/config.json)"
        />
        <Form.Dropdown.Item value="env" title="Environment Variables" />
        <Form.Dropdown.Item value="manual" title="Manual" />
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        id="host"
        title="PI Host"
        placeholder="localhost"
        defaultValue={preferences.host || detectedConfig.host || "localhost"}
        info="Server hostname or IP address"
      />

      <Form.TextField
        id="port"
        title="PI Port"
        placeholder="11434"
        defaultValue={
          preferences.port || detectedConfig.port?.toString() || "11434"
        }
        info="Default: 11434"
      />

      <Form.PasswordField
        id="apiKey"
        title="API Key"
        placeholder="Auto-detected from config"
        defaultValue={preferences.apiKey || detectedConfig.apiKey || ""}
        info="Leave empty to auto-detect from existing PI config"
      />

      <Form.TextField
        id="endpoint"
        title="API Endpoint"
        placeholder="/api/v1/chat"
        defaultValue={detectedConfig.endpoint || "/api/v1/chat"}
        info="API endpoint path"
      />

      <Form.Separator />

      <Form.Dropdown
        id="model"
        title="Default Model"
        defaultValue={preferences.model || "auto"}
        info="Choose the default AI model"
      >
        <Form.Dropdown.Item value="auto" title="⚡ Auto-detect" />
        <Form.Dropdown.Item value="pi-chat" title="💬 PI Chat" />
        <Form.Dropdown.Item value="pi-code" title="💻 PI Code" />
      </Form.Dropdown>

      <Form.Dropdown
        id="temperature"
        title="Temperature"
        defaultValue={preferences.temperature || "0.7"}
        info="Controls response creativity (0 = precise, 2 = creative)"
      >
        <Form.Dropdown.Item
          value="0.2"
          title="🎯 Precise (0.2)"
          subtitle="Best for factual tasks"
        />
        <Form.Dropdown.Item
          value="0.5"
          title="⚖️ Balanced (0.5)"
          subtitle="Good all-rounder"
        />
        <Form.Dropdown.Item
          value="0.7"
          title="🎨 Creative (0.7)"
          subtitle="Best for brainstorming"
        />
        <Form.Dropdown.Item
          value="1.0"
          title="🚀 Very Creative (1.0)"
          subtitle="Maximum creativity"
        />
      </Form.Dropdown>

      <Form.Checkbox
        id="streamResponses"
        label="Enable streaming responses"
        defaultValue={preferences.streamResponses ?? true}
        info="Show responses as they're generated"
      />

      {testResult && (
        <Form.Description
          title="Connection Test Result"
          text={testResult.message}
        />
      )}

      <Form.Separator />

      <Form.Description
        title="Detected Configuration"
        text={`Host: ${detectedConfig.host}:${detectedConfig.port}\nAPI Key: ${detectedConfig.apiKey ? "✓ Configured" : "✗ Not set"}`}
      />
    </Form>
  );
}
