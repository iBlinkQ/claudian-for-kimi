import { Setting } from 'obsidian';

import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { getGeminiProviderSettings, updateGeminiProviderSettings } from '../settings';

const geminiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
    const { plugin } = context;
    const settings = plugin.settings as Record<string, unknown>;
    const geminiSettings = getGeminiProviderSettings(settings);

    container.createEl('h3', { text: 'Gemini CLI' });

    new Setting(container)
      .setName('Enable Gemini provider')
      .setDesc('Enable Gemini CLI as an AI provider.')
      .addToggle(toggle => toggle
        .setValue(geminiSettings.enabled)
        .onChange(async (value) => {
          updateGeminiProviderSettings(settings, { enabled: value });
          await plugin.saveSettings();
        }));

    new Setting(container)
      .setName('CLI path')
      .setDesc('Path to the gemini CLI binary. Leave empty to use the default from PATH.')
      .addText(text => text
        .setPlaceholder('gemini')
        .setValue(geminiSettings.cliPath)
        .onChange(async (value) => {
          updateGeminiProviderSettings(settings, { cliPath: value });
          await plugin.saveSettings();
        }));

    new Setting(container)
      .setName('Default model')
      .setDesc('Default Gemini model to use.')
      .addDropdown(dropdown => dropdown
        .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
        .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
        .addOption('gemini-2.0-flash', 'Gemini 2.0 Flash')
        .setValue(geminiSettings.defaultModel)
        .onChange(async (value) => {
          updateGeminiProviderSettings(settings, { defaultModel: value });
          await plugin.saveSettings();
        }));

    new Setting(container)
      .setName('Environment variables')
      .setDesc('Environment variables passed to the Gemini CLI (one per line, KEY=VALUE).')
      .addTextArea(textarea => textarea
        .setPlaceholder('GEMINI_API_KEY=your-key\nGOOGLE_CLOUD_PROJECT=your-project')
        .setValue(geminiSettings.environmentVariables)
        .onChange(async (value) => {
          updateGeminiProviderSettings(settings, { environmentVariables: value });
          await plugin.saveSettings();
        }));

    const contextLimitsContainer = container.createDiv();
    context.renderCustomContextLimits(contextLimitsContainer, 'gemini');
  },
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- placeholder for future Gemini-specific services
export interface GeminiWorkspaceServices extends ProviderWorkspaceServices {}

export const geminiWorkspaceRegistration: ProviderWorkspaceRegistration<GeminiWorkspaceServices> = {
  initialize: async () => ({
    settingsTabRenderer: geminiSettingsTabRenderer,
  }),
};
