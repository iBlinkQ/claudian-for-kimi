import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '../settings';
import { geminiChatUIConfig } from '../ui/GeminiChatUIConfig';

const ENV_HASH_KEYS = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GOOGLE_API_KEY'];

function computeGeminiEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return ENV_HASH_KEYS
    .filter(key => envVars[key])
    .map(key => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const geminiSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'gemini');
    const currentHash = computeGeminiEnvHash(envText);
    const savedHash = getGeminiProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      if (conv.providerId === 'gemini' && conv.sessionId) {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

    const envVars = parseEnvironmentVariables(envText || '');
    if (envVars.GEMINI_MODEL) {
      settings.model = envVars.GEMINI_MODEL;
    } else if (
      typeof settings.model === 'string'
      && settings.model.length > 0
      && !geminiChatUIConfig.isDefaultModel(settings.model)
    ) {
      settings.model = geminiChatUIConfig.getModelOptions({})[0]?.value ?? 'gemini-2.5-flash';
    }

    updateGeminiProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(): boolean {
    return false;
  },
};
