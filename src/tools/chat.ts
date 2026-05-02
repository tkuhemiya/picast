/**
 * PI Chat Tool
 *
 * This tool allows Raycast AI to chat with your local PI agent.
 * It's used when users mention @picast in Raycast AI chat.
 */

import { createPIClient } from "../../lib/pi-client";
import { getConfig, mergeConfig } from "../../lib/config";

type Input = {
  /**
   * The user's prompt or question
   */
  prompt: string;
  /**
   * Optional context from selection, files, or clipboard
   */
  context?: string;
  /**
   * Conversation history for continuity
   */
  history?: Array<{ role: string; content: string }>;
  /**
   * Model to use (defaults to configured model)
   */
  model?: string;
};

/**
 * Chat with PI agent using your local setup
 */
export default async function chatTool(input: Input): Promise<string> {
  try {
    // Get configuration
    const detectedConfig = getConfig("auto");
    const config = mergeConfig(detectedConfig, {});

    // Create PI client
    const piClient = createPIClient(config);

    // Build messages array
    const messages: Array<{ role: string; content: string }> = [];

    // Add system context if provided
    if (input.context) {
      messages.push({
        role: "system",
        content: `Context:\n${input.context}`,
      });
    }

    // Add conversation history (limit to last 10 messages)
    if (input.history && input.history.length > 0) {
      const limitedHistory = input.history.slice(-10);
      messages.push(...limitedHistory);
    }

    // Add current prompt
    messages.push({
      role: "user",
      content: input.prompt,
    });

    // Send request
    const response = await piClient.chat({
      model: input.model || config.defaultModel,
      messages: messages,
      temperature: 0.7,
    });

    // Extract and return response
    const content =
      response.choices?.[0]?.message?.content ||
      response.choices?.[0]?.text ||
      "No response received";

    return content;
  } catch (error) {
    console.error("PI Chat Tool error:", error);
    throw new Error(
      `Failed to get response from PI: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
