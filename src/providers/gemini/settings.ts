import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export interface GeminiProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  defaultModel: string;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_GEMINI_PROVIDER_SETTINGS: Readonly<GeminiProviderSettings> = Object.freeze({
  enabled: false,
  cliPath: '',
  cliPathsByHost: {},
  defaultModel: 'gemini-2.5-flash',
  environmentVariables: '',
  environmentHash: '',
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function getGeminiProviderSettings(
  settings: Record<string, unknown>,
): GeminiProviderSettings {
  const config = getProviderConfig(settings, 'gemini');
  const hostnameKey = getHostnameKey();
  const cliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);

  return {
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.enabled,
    cliPath: (cliPathsByHost[hostnameKey])
      ?? (config.cliPath as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    defaultModel: (config.defaultModel as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.defaultModel,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'gemini')
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.environmentHash,
  };
}

export function updateGeminiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<GeminiProviderSettings>,
): GeminiProviderSettings {
  const current = getGeminiProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const cliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };

  if ('cliPath' in updates && updates.cliPath) {
    cliPathsByHost[hostnameKey] = updates.cliPath.trim();
  }

  const next: GeminiProviderSettings = {
    ...current,
    ...updates,
    cliPath: cliPathsByHost[hostnameKey] ?? DEFAULT_GEMINI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
  };

  setProviderConfig(settings, 'gemini', {
    enabled: next.enabled,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    defaultModel: next.defaultModel,
    environmentVariables: next.environmentVariables,
    environmentHash: next.environmentHash,
  });
  return next;
}
