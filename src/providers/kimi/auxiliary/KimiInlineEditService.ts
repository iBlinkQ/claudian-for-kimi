import { type ChildProcess, spawn } from 'child_process';
import { Platform } from 'obsidian';

import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
} from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getKimiProviderSettings } from '../settings';

export class KimiInlineEditService implements InlineEditService {
  private plugin: ClaudianPlugin;
  private currentProcess: ChildProcess | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  resetConversation(): void {
    this.cancel();
  }

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      return { success: false, error: 'Kimi CLI not found' };
    }

    let prompt: string;

    if (request.mode === 'selection') {
      prompt = `You are an inline text editor. Apply the following instruction to the given text.
Instruction: ${request.instruction}
File: ${request.notePath}

Original text:
\`\`\`
${request.selectedText}
\`\`\`

Return ONLY the edited text, with no explanation, no code fences, no markdown formatting. Just the raw edited content.`;
    } else {
      const ctx = request.cursorContext;
      prompt = `You are an inline text editor. The cursor is at line ${ctx.line}, column ${ctx.column} in file "${request.notePath}".

Context before cursor:
\`\`\`
${ctx.beforeCursor}
\`\`\`

Context after cursor:
\`\`\`
${ctx.afterCursor}
\`\`\`

Instruction: ${request.instruction}

Return ONLY the text to insert at the cursor position, with no explanation, no code fences, no markdown formatting. Just the raw text to insert.`;
    }

    try {
      const result = await this.runHeadless(cliPath, prompt);
      if (request.mode === 'selection') {
        return { success: true, editedText: result };
      } else {
        return { success: true, insertedText: result };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  async continueConversation(
    _message: string,
    _contextFiles?: string[],
  ): Promise<InlineEditResult> {
    return {
      success: false,
      error: 'Multi-turn inline editing is not supported by the Kimi provider',
    };
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
          reject(new Error('Inline edit timed out'));
        }
      }, 60000);
    });
  }
}
