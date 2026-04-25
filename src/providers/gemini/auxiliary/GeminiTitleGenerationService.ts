import { type ChildProcess,spawn } from 'child_process';
import { Platform } from 'obsidian';

import type {
  TitleGenerationCallback,
  TitleGenerationService,
} from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { getGeminiProviderSettings } from '../settings';

export class GeminiTitleGenerationService implements TitleGenerationService {
  private plugin: ClaudianPlugin;
  private currentProcess: ChildProcess | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      await callback(conversationId, {
        success: false,
        error: 'Gemini CLI not found',
      });
      return;
    }

    const truncatedMessage = userMessage.substring(0, 500);
    const prompt = `Generate a very short title (max 6 words, no quotes, no punctuation at the end) for a conversation that starts with: "${truncatedMessage}"`;

    try {
      const result = await this.runHeadless(cliPath, prompt);
      const title = result.trim().replace(/^["']|["']$/g, '').substring(0, 100);

      if (title) {
        await callback(conversationId, { success: true, title });
      } else {
        await callback(conversationId, {
          success: false,
          error: 'Empty title generated',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await callback(conversationId, { success: false, error: message });
    }
  }

  cancel(): void {
    if (this.currentProcess) {
      try {
        this.currentProcess.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
      this.currentProcess = null;
    }
  }

  private resolveCliPath(): string | null {
    const settings = getGeminiProviderSettings(
      this.plugin.settings as Record<string, unknown>,
    );
    if (settings.cliPath) return settings.cliPath;
    return Platform.isWin ? 'gemini.cmd' : 'gemini';
  }

  private runHeadless(cliPath: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cliPath, [
        '-p', prompt,
        '--output-format', 'json',
        '-m', 'gemini-2.5-flash',
        '--sandbox', 'none',
      ], {
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.currentProcess = proc;
      let stdout = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        this.currentProcess = null;
        try {
          const parsed = JSON.parse(stdout);
          resolve((parsed.response as string) || '');
        } catch {
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(err);
      });

      setTimeout(() => {
        if (this.currentProcess === proc) {
          proc.kill();
          reject(new Error('Title generation timed out'));
        }
      }, 30000);
    });
  }
}
