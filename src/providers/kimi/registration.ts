import type { ProviderRegistration } from '../../core/providers/types';
import { KimiInlineEditService } from './auxiliary/KimiInlineEditService';
import { KimiInstructionRefineService } from './auxiliary/KimiInstructionRefineService';
import { KimiTaskResultInterpreter } from './auxiliary/KimiTaskResultInterpreter';
import { KimiTitleGenerationService } from './auxiliary/KimiTitleGenerationService';
import { KIMI_PROVIDER_CAPABILITIES } from './capabilities';
import { kimiSettingsReconciler } from './env/KimiSettingsReconciler';
import { KimiConversationHistoryService } from './history/KimiConversationHistoryService';
import { KimiChatRuntime } from './runtime/KimiChatRuntime';
import { getKimiProviderSettings } from './settings';
import { kimiChatUIConfig } from './ui/KimiChatUIConfig';

export const kimiProviderRegistration: ProviderRegistration = {
  displayName: 'Kimi',
  blankTabOrder: 30,
  isEnabled: (settings) => getKimiProviderSettings(settings).enabled,
  capabilities: KIMI_PROVIDER_CAPABILITIES,
  environmentKeyPatterns: [/^KIMI_/i, /^MOONSHOT_/i],
  chatUIConfig: kimiChatUIConfig,
  settingsReconciler: kimiSettingsReconciler,
  createRuntime: ({ plugin }) => new KimiChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new KimiTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new KimiInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new KimiInlineEditService(plugin),
  historyService: new KimiConversationHistoryService(),
  taskResultInterpreter: new KimiTaskResultInterpreter(),
};
