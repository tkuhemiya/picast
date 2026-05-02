import os from "os";
import fs from "fs";
import path from "path";

/**
 * PI Configuration interface
 */
export interface PIConfig {
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
}

/**
 * Configuration file paths to check (in priority order)
 */
const CONFIG_PATHS = [
  path.join(os.homedir(), ".picast", "config.json"),
  path.join(os.homedir(), ".config", "picast", "config.json"),
  path.join(process.cwd(), "picast.json"),
  path.join(process.cwd(), ".picast.json"),
];

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: PIConfig = {
  defaultModel: "auto",
};

/**
 * Load configuration from file
 */
function loadConfigFromFile(configPath: string): PIConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      return {
        ...DEFAULT_CONFIG,
        ...config,
      };
    }
  } catch (error) {
    console.error(`Error reading config from ${configPath}:`, error);
  }
  return null;
}

/**
 * Load configuration from environment variables
 */
function loadConfigFromEnv(): PIConfig {
  return {
    apiKey: process.env.PI_API_KEY,
    defaultModel: process.env.PI_DEFAULT_MODEL || "auto",
  };
}

/**
 * Auto-detect configuration from all sources
 */
export function autoDetectConfig(): PIConfig {
  // Try config files first
  for (const configPath of CONFIG_PATHS) {
    const config = loadConfigFromFile(configPath);
    if (config) {
      console.log(`Loaded config from ${configPath}`);
      return config;
    }
  }

  // Fall back to environment variables
  const envConfig = loadConfigFromEnv();
  if (envConfig.host || envConfig.apiKey) {
    console.log("Loaded config from environment variables");
    return envConfig;
  }

  // Return defaults
  console.log("Using default configuration");
  return DEFAULT_CONFIG;
}

/**
 * Get configuration based on source preference
 */
export function getConfig(source: string = "auto"): PIConfig {
  switch (source) {
    case "file":
      // Try first config path
      const fileConfig = loadConfigFromFile(CONFIG_PATHS[0]);
      if (fileConfig) {
        return fileConfig;
      }
      return autoDetectConfig();

    case "env":
      return loadConfigFromEnv();

    case "manual":
      // Will be populated from Raycast preferences
      return DEFAULT_CONFIG;

    case "auto":
    default:
      return autoDetectConfig();
  }
}

/**
 * Merge Raycast preferences with detected config
 */
export function mergeConfig(
  detectedConfig: PIConfig,
  preferences: {
    host?: string;
    port?: string;
    apiKey?: string;
    model?: string;
    temperature?: string;
    streamResponses?: boolean;
    endpoint?: string;
  }
): PIConfig {
  return {
    ...detectedConfig,
    host: preferences.host || detectedConfig.host,
    port: preferences.port ? parseInt(preferences.port, 10) : detectedConfig.port,
    apiKey: preferences.apiKey || detectedConfig.apiKey,
    endpoint: preferences.endpoint || detectedConfig.endpoint,
    defaultModel: preferences.model !== "auto" ? preferences.model : detectedConfig.defaultModel,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: PIConfig): { valid: boolean; error?: string } {
  // Config is always valid - we use pi's auth.json for credentials
  return { valid: true };
}
