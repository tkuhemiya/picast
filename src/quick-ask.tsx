import { showToast, Toast, showHUD } from "@raycast/api";
import { getConfig, mergeConfig } from "../lib/config";
import { createPIClient } from "../lib/pi-client";

interface Arguments {
  prompt: string;
}

export default async function quickAskCommand({ prompt }: Arguments) {
  try {
    if (!prompt || prompt.trim().length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Prompt Provided",
        message: "Please provide a question to ask PI",
      });
      return;
    }

    // Show loading indicator
    const hud = await showHUD("Asking PI...");

    try {
      // Get configuration
      const detectedConfig = getConfig("auto");
      const config = mergeConfig(detectedConfig, {});

      // Create client and send request
      const piClient = createPIClient(config);

      const response = await piClient.chat({
        model: config.defaultModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      });

      // Extract response
      const answer =
        response.choices?.[0]?.message?.content ||
        response.choices?.[0]?.text ||
        "No response received";

      // Copy to clipboard
      const Clipboard = await import("@raycast/api");
      await Clipboard.Clipboard.copy(answer);

      await showToast({
        style: Toast.Style.Success,
        title: "Response Copied",
        message: "PI's answer has been copied to your clipboard",
      });
    } finally {
      hud.dismiss();
    }
  } catch (error) {
    console.error("Quick ask error:", error);

    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to Get Response",
      message: error instanceof Error ? error.message : "Unknown error",
      primaryAction: {
        title: "Configure PI",
        onAction: () => {
          // Could navigate to configure command
        },
      },
    });
  }
}
