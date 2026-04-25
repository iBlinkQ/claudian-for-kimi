import { type ChildProcess, spawn } from 'child_process';
import { Platform } from 'obsidian';

import type {
  TitleGenerationCallback,
  TitleGenerationService,
} from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getKimiProviderSettings } from '../settings';

export class KimiTitleGenerationService implements TitleGenerationService {
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
        error: 'Kimi CLI not found',
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
    const settings = getKimiProviderSettings(
      this.plugin.settings as Record<string, unknown>,
    );
    if (settings.cliPath) return settings.cliPath;
    return Platform.isWin ? 'kimi.exe' : 'kimi';
  }

  private runHeadless(cliPath: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      env.PATH = getEnhancedPath(env.PATH, cliPath);
      const home = env.HOME || process.env.HOME;
      if (home && !env.PATH!.includes(`${home}/.local/bin`)) {
        env.PATH = `${home}/.local/bin:${env.PATH}`;
      }
      env.TERM = 'dumb';
      env.NO_COLOR = '1';

      const proc = spawn(cliPath, [
        '-p', prompt,
        '--print',
        '--output-format', 'stream-json',
      ], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.currentProcess = proc;
      proc.stdin?.end();
      let stdout = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        this.currentProcess = null;
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.role === 'assistant' && Array.isArray(parsed.content)) {
            const textPart = parsed.content.find((p: any) => p.type === 'text');
            resolve(textPart?.text || '');
          } else {
            resolve(stdout.trim());
          }
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
