import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderIconSvg,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';

const GEMINI_ICON: ProviderIconSvg = {
  viewBox: '0 0 24 24',
  path: 'M12 0C12 0 12 8.5 7.5 12C12 15.5 12 24 12 24C12 24 12 15.5 16.5 12C12 8.5 12 0 12 0Z',
};

const GEMINI_MODELS: ProviderUIOption[] = [
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', description: 'Next generation fast' },
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)', description: 'Next generation capable' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast & efficient' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Legacy fast' },
];

const GEMINI_MODEL_SET = new Set(GEMINI_MODELS.map(m => m.value));

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

function looksLikeGeminiModel(model: string): boolean {
  return /^gemini-/i.test(model);
}

export const geminiChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const envVars = getRuntimeEnvironmentVariables(settings, 'gemini');
    if (envVars.GEMINI_MODEL) {
      const customModel = envVars.GEMINI_MODEL;
      if (!GEMINI_MODEL_SET.has(customModel)) {
        return [
          { value: customModel, label: customModel, description: 'Custom (env)' },
          ...GEMINI_MODELS,
        ];
      }
    }
    return [...GEMINI_MODELS];
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (this.getModelOptions(settings).some((option: ProviderUIOption) => option.value === model)) {
      return true;
    }
    return looksLikeGeminiModel(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(_model: string, customLimits?: Record<string, number>): number {
    if (customLimits) {
      const custom = customLimits[_model];
      if (custom) return custom;
    }
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return GEMINI_MODEL_SET.has(model);
  },

  applyModelDefaults(): void {
    // No-op for Gemini
  },

  normalizeModelVariant(model: string): string {
    return model;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.GEMINI_MODEL && !GEMINI_MODEL_SET.has(envVars.GEMINI_MODEL)) {
      ids.add(envVars.GEMINI_MODEL);
    }
    return ids;
  },

  getProviderIcon() {
    return GEMINI_ICON;
  },
};
