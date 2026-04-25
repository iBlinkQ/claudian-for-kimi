import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderIconSvg,
  ProviderUIOption,
} from '../../../core/providers/types';

const KIMI_ICON: ProviderIconSvg = {
  viewBox: '0 0 24 24',
  path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z', // Reusing placeholder info logo; real kimi logo could go here
};

const KIMI_MODELS: ProviderUIOption[] = [
  { value: 'kimi-default', label: 'Kimi (Kimi-k2.6)', description: 'Kimi CLI Auto-routing Agent' },
];

const KIMI_MODEL_SET = new Set(KIMI_MODELS.map(m => m.value));

const DEFAULT_CONTEXT_WINDOW = 200_000;

function looksLikeKimiModel(model: string): boolean {
  return /^kimi-|moonshot-/i.test(model);
}

export const kimiChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const envVars = getRuntimeEnvironmentVariables(settings, 'kimi');
    if (envVars.KIMI_MODEL) {
      const customModel = envVars.KIMI_MODEL;
      if (!KIMI_MODEL_SET.has(customModel)) {
        return [
          { value: customModel, label: customModel, description: 'Custom (env)' },
          ...KIMI_MODELS,
        ];
      }
    }
    return [...KIMI_MODELS];
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (this.getModelOptions(settings).some((option: ProviderUIOption) => option.value === model)) {
      return true;
    }
    return looksLikeKimiModel(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getDefaultReasoningValue(): string {
    return 'medium';
  },

  isDefaultModel(model: string): boolean {
    return KIMI_MODELS.some(m => m.value === model);
  },

  applyModelDefaults(model: string, settings: Record<string, unknown>): void {
    settings.contextWindow = DEFAULT_CONTEXT_WINDOW;
  },

  getReasoningOptions(model: string): import('../../../core/providers/types').ProviderReasoningOption[] {
    return [];
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    return model;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const customModels = new Set<string>();
    if (envVars.KIMI_MODEL && !KIMI_MODEL_SET.has(envVars.KIMI_MODEL)) {
      customModels.add(envVars.KIMI_MODEL);
    }
    return customModels;
  },

  getIcon(): ProviderIconSvg {
    return KIMI_ICON;
  },

  getChatTitle(): string {
    return 'Kimi Code CLI';
  },
};
