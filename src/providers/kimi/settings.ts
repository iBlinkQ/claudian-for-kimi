import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export interface KimiProviderSettings {
  enabled: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  environmentVariables: string;
  environmentHash: string;
}

export const DEFAULT_KIMI_PROVIDER_SETTINGS: Readonly<KimiProviderSettings> = Object.freeze({
  enabled: true,
  cliPath: '',
  cliPathsByHost: {},
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

export function getKimiProviderSettings(
  settings: Record<string, unknown>,
): KimiProviderSettings {
  const config = getProviderConfig(settings, 'kimi');

  return {
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.enabled,
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'kimi')
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.environmentVariables,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_KIMI_PROVIDER_SETTINGS.environmentHash,
  };
}

export function updateKimiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<KimiProviderSettings>,
): KimiProviderSettings {
  const current = getKimiProviderSettings(settings);
  const next: KimiProviderSettings = { ...current, ...updates };

  setProviderConfig(settings, 'kimi', {
    enabled: next.enabled,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    environmentVariables: next.environmentVariables,
    environmentHash: next.environmentHash,
  });
  return next;
}
