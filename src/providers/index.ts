import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import { claudeWorkspaceRegistration } from './claude/app/ClaudeWorkspaceServices';
import { claudeProviderRegistration } from './claude/registration';
import { codexWorkspaceRegistration } from './codex/app/CodexWorkspaceServices';
import { codexProviderRegistration } from './codex/registration';
import { geminiWorkspaceRegistration } from './gemini/app/GeminiWorkspaceServices';
import { geminiProviderRegistration } from './gemini/registration';
import { kimiWorkspaceRegistration } from './kimi/app/KimiWorkspaceServices';
import { kimiProviderRegistration } from './kimi/registration';

let builtInProvidersRegistered = false;

export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  ProviderRegistry.register('claude', claudeProviderRegistration);
  ProviderRegistry.register('codex', codexProviderRegistration);
  ProviderRegistry.register('gemini', geminiProviderRegistration);
  ProviderRegistry.register('kimi', kimiProviderRegistration);
  ProviderWorkspaceRegistry.register('claude', claudeWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('codex', codexWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('gemini', geminiWorkspaceRegistration);
  ProviderWorkspaceRegistry.register('kimi', kimiWorkspaceRegistration);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();
