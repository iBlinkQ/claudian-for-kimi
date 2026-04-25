import { Setting } from 'obsidian';

import type {
  ProviderSettingsTabRenderer,
  ProviderSettingsTabRendererContext,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { getKimiProviderSettings, updateKimiProviderSettings } from '../settings';

const kimiSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container: HTMLElement, context: ProviderSettingsTabRendererContext): void {
    const { plugin } = context;
    const settings = plugin.settings as Record<string, unknown>;
    
    try {
      const kimiSettings = getKimiProviderSettings(settings);

    container.createEl('h3', { text: 'Kimi CLI' });

    new Setting(container)
      .setName('Enable Kimi provider')
      .setDesc('Enable Kimi CLI as an AI provider.')
      .addToggle(toggle => toggle
        .setValue(kimiSettings.enabled)
        .onChange(async (value) => {
          updateKimiProviderSettings(settings, { enabled: value });
          await plugin.saveSettings();
        }));

    new Setting(container)
      .setName('CLI path')
      .setDesc('Path to the kimi CLI binary. Leave empty to use the default from PATH (installed via uv).')
      .addText(text => text
        .setPlaceholder('kimi')
        .setValue(kimiSettings.cliPath)
        .onChange(async (value) => {
          updateKimiProviderSettings(settings, { cliPath: value });
          await plugin.saveSettings();
        }));

    new Setting(container)
      .setName('Environment variables')
      .setDesc('Environment variables passed to the Kimi CLI (one per line, KEY=VALUE). E.g. KIMI_API_KEY=xxx')
      .addTextArea(textarea => textarea
        .setPlaceholder('KIMI_API_KEY=your-key')
        .setValue(kimiSettings.environmentVariables)
        .onChange(async (value) => {
          updateKimiProviderSettings(settings, { environmentVariables: value });
          await plugin.saveSettings();
        }));

      const contextLimitsContainer = container.createDiv();
      context.renderCustomContextLimits(contextLimitsContainer, 'kimi');
    } catch (e) {
      container.createEl('h2', { text: 'Settings Render Error' });
      container.createEl('pre', { text: String(e instanceof Error ? e.stack : e) });
    }
  },
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- placeholder for future Kimi-specific services
export interface KimiWorkspaceServices extends ProviderWorkspaceServices {}

export const kimiWorkspaceRegistration: ProviderWorkspaceRegistration<KimiWorkspaceServices> = {
  initialize: async () => ({
    settingsTabRenderer: kimiSettingsTabRenderer,
  }),
};
