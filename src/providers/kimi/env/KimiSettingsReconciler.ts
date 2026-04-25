import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getKimiProviderSettings, updateKimiProviderSettings } from '../settings';
import { kimiChatUIConfig } from '../ui/KimiChatUIConfig';

const ENV_HASH_KEYS = ['KIMI_API_KEY', 'KIMI_MODEL'];

function computeKimiEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return ENV_HASH_KEYS
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const kimiSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'kimi');
    const currentHash = computeKimiEnvHash(envText);
    const savedHash = getKimiProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      if (conv.providerId === 'kimi' && conv.sessionId) {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

    const envVars = parseEnvironmentVariables(envText || '');
    if (envVars.KIMI_MODEL) {
      settings.model = envVars.KIMI_MODEL;
    } else if (
      typeof settings.model === 'string'
      && settings.model.length > 0
      && !kimiChatUIConfig.isDefaultModel(settings.model)
    ) {
      settings.model = kimiChatUIConfig.getModelOptions({})[0]?.value ?? 'moonshot-v1-8k';
    }

    updateKimiProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(): boolean {
    return false;
  },
};
