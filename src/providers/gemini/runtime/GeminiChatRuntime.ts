import { type ChildProcess,spawn } from 'child_process';
import { Platform } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnResult,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type { ChatMessage, Conversation, SlashCommand, StreamChunk } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { GEMINI_PROVIDER_CAPABILITIES } from '../capabilities';
import { getGeminiProviderSettings } from '../settings';

/**
 * Gemini CLI Chat Runtime.
 *
 * Uses `gemini -p <prompt> --output-format stream-json` (headless mode)
 * to communicate with the Gemini CLI. Each query spawns a new process.
 *
 * Stream-JSON output format emits newline-delimited JSON events:
 * - init: Session metadata (session ID, model)
 * - message: User and assistant message chunks
 * - tool_use: Tool call requests with arguments
 * - tool_result: Output from executed tools
 * - error: Non-fatal warnings and system errors
 * - result: Final outcome with aggregated statistics
 */
export class GeminiChatRuntime implements ChatRuntime {
  readonly providerId = 'gemini';
  private plugin: ClaudianPlugin;
  private currentProcess: ChildProcess | null = null;
  private cancelled = false;
  private ready = false;
  private readyListeners: Set<(ready: boolean) => void> = new Set();
  private turnMetadata: ChatTurnMetadata = {};

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GEMINI_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: false,
      mcpMentions: new Set(),
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {
    // No-op: Gemini headless mode doesn't support checkpoints
  }

  syncConversationState(
    _conversation: ChatRuntimeConversationState | null,
    _externalContextPaths?: string[],
  ): void {
    // No-op: each query is independent
  }

  async reloadMcpServers(): Promise<void> {
    // No-op: MCP not yet supported in Gemini provider
  }

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      this.setReady(false);
      return false;
    }

    try {
      const result = await this.execCliCommand(cliPath, ['--version']);
      const isReady = result.exitCode === 0;
      this.setReady(isReady);
      return isReady;
    } catch {
      this.setReady(false);
      return false;
    }
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.cancelled = false;
    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      yield { type: 'error', content: 'Gemini CLI not found. Please install it with: npm install -g @google/gemini-cli' };
      yield { type: 'done' };
      return;
    }

    // Build full prompt with conversation history context
    const fullPrompt = this.buildPromptWithHistory(turn.prompt, conversationHistory);

    const scopedSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings as Record<string, unknown>,
      this.providerId,
    );

    const model = queryOptions?.model
      ?? scopedSettings.model as string
      ?? 'gemini-2.5-flash';

    const vaultPath = getVaultPath(this.plugin.app);
    const args = [
      '-p', fullPrompt,
      '--output-format', 'stream-json',
      '-m', model,
    ];


    // Build environment with any configured variables
    const env = this.buildEnvironment();

    yield { type: 'assistant_message_start' };

    const process = spawn(cliPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: vaultPath || undefined,
    });

    this.currentProcess = process;

    let buffer = '';
    let hasResponse = false;
    let spawnError: Error | null = null;
    let stderrBuffer = '';

    process.on('error', (err) => {
      spawnError = err;
    });

    if (process.stderr) {
      process.stderr.setEncoding('utf8');
      process.stderr.on('data', (data) => {
        stderrBuffer += (typeof data === 'string' ? data : data.toString());
      });
    }

    try {
      if (!process.stdout) throw new Error('Failed to capture process stdout');
      process.stdout.setEncoding('utf8');

      for await (const chunk of process.stdout) {
        if (this.cancelled) break;

        buffer += (typeof chunk === 'string' ? chunk : (chunk as Buffer).toString());
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const jsonLine of lines) {
          const trimmed = jsonLine.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);
            const streamChunks = this.mapEventToStreamChunks(event);
            for (const chunk of streamChunks) {
              if (chunk.type === 'text') hasResponse = true;
              yield chunk;
            }
          } catch {
            // Skip non-JSON lines (e.g. progress indicators)
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          const streamChunks = this.mapEventToStreamChunks(event);
          for (const chunk of streamChunks) {
            if (chunk.type === 'text') hasResponse = true;
            yield chunk;
          }
        } catch {
          // Skip
        }
      }

      if (spawnError) {
        yield { type: 'error', content: `Failed to start Gemini CLI: ${(spawnError as Error).message}. Please ensure the CLI path is correctly configured in settings or that 'gemini' is in your PATH.` };
      } else if (!hasResponse && !this.cancelled) {
        const errorDetails = stderrBuffer.trim() ? `\n\nDetails: ${stderrBuffer.trim()}` : '';
        yield { type: 'error', content: `No response received from Gemini CLI. Check your authentication and try again.${errorDetails}` };
      }

    } catch (err: unknown) {
      if (!this.cancelled) {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: 'error', content: `Gemini CLI error: ${message}` };
      }
    } finally {
      this.currentProcess = null;
      yield { type: 'done' };
    }
  }

  cancel(): void {
    this.cancelled = true;
    if (this.currentProcess) {
      try {
        this.currentProcess.kill('SIGTERM');
        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          if (this.currentProcess) {
            this.currentProcess.kill('SIGKILL');
          }
        }, 2000);
      } catch {
        // Process may already be dead
      }
    }
  }

  resetSession(): void {
    this.cancel();
    this.turnMetadata = {};
  }

  getSessionId(): string | null {
    return null;
  }

  consumeSessionInvalidation(): boolean {
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  cleanup(): void {
    this.cancel();
    this.readyListeners.clear();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Rewind is not supported by the Gemini provider' };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {
    // No-op
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {
    // No-op
  }

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {
    // No-op
  }

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {
    // No-op
  }

  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {
    // No-op
  }

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {
    // No-op
  }

  setAutoTurnCallback(_callback: ((result: AutoTurnResult) => void) | null): void {
    // No-op
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const meta = { ...this.turnMetadata };
    this.turnMetadata = {};
    return meta;
  }

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return { updates: {} };
  }

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private setReady(value: boolean): void {
    if (this.ready !== value) {
      this.ready = value;
      for (const listener of this.readyListeners) {
        listener(value);
      }
    }
  }

  private resolveCliPath(): string | null {
    const settings = getGeminiProviderSettings(
      this.plugin.settings as Record<string, unknown>,
    );

    if (settings.cliPath) {
      return settings.cliPath;
    }

    // Default paths
    if (Platform.isWin) {
      return 'gemini.cmd';
    }

    return 'gemini';
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const settings = getGeminiProviderSettings(
      this.plugin.settings as Record<string, unknown>,
    );

    const customEnvVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables(this.providerId),
    );

    // Parse and apply configured environment variables
    if (settings.environmentVariables) {
      for (const [key, value] of Object.entries(customEnvVars)) {
        env[key] = value;
      }
    }

    // Crucial: Enhance PATH so '/usr/bin/env node' can find 'node'
    // when launched from Obsidian's limited GUI PATH
    env.PATH = getEnhancedPath(env.PATH, this.resolveCliPath() || undefined);


    // Force non-interactive mode
    env.TERM = 'dumb';
    env.NO_COLOR = '1';

    return env;
  }

  private buildPromptWithHistory(
    currentPrompt: string,
    conversationHistory?: ChatMessage[],
  ): string {
    if (!conversationHistory || conversationHistory.length === 0) {
      return currentPrompt;
    }

    // Build context from previous messages (last N messages to stay within limits)
    const maxHistoryMessages = 20;
    const recentHistory = conversationHistory.slice(-maxHistoryMessages);

    const historyParts: string[] = [];
    for (const msg of recentHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      if (msg.content) {
        historyParts.push(`${role}: ${msg.content}`);
      }
    }

    if (historyParts.length === 0) {
      return currentPrompt;
    }

    return `Previous conversation context:\n${historyParts.join('\n\n')}\n\nUser: ${currentPrompt}`;
  }

  /**
   * Maps a Gemini stream-json event to Claudian StreamChunk(s).
   *
   * Event types from Gemini CLI headless mode:
   * - init: { type: "init", sessionId, model }
   * - message: { type: "message", role, content }
   * - tool_use: { type: "tool_use", id, name, args }
   * - tool_result: { type: "tool_result", id, output, isError }
   * - error: { type: "error", message }
   * - result: { type: "result", response, stats }
   */
  private mapEventToStreamChunks(event: Record<string, unknown>): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const type = event.type as string;

    switch (type) {
      case 'init':
        // Session started — no visible output needed
        break;

      case 'message': {
        const role = event.role as string;
        const content = event.content as string;
        if (role === 'assistant' && content) {
          chunks.push({ type: 'text', content });
        }
        break;
      }

      case 'tool_use': {
        const id = (event.id as string) || `tool_${Date.now()}`;
        const name = (event.name as string) || 'unknown_tool';
        const input = (event.args as Record<string, unknown>) || {};
        chunks.push({ type: 'tool_use', id, name, input });
        break;
      }

      case 'tool_result': {
        const id = (event.id as string) || `tool_${Date.now()}`;
        const output = (event.output as string) || '';
        const isError = (event.isError as boolean) || false;
        chunks.push({ type: 'tool_result', id, content: output, isError });
        break;
      }

      case 'error': {
        const message = (event.message as string) || 'Unknown error';
        chunks.push({ type: 'error', content: message });
        break;
      }

      case 'result': {
        // Final result with response text and usage stats
        const response = event.response as string;
        if (response) {
          chunks.push({ type: 'text', content: response });
        }

        const stats = event.stats as Record<string, unknown> | undefined;
        if (stats) {
          const inputTokens = (stats.inputTokens as number) || 0;
          const outputTokens = (stats.outputTokens as number) || 0;
          chunks.push({
            type: 'usage',
            usage: {
              inputTokens,
              contextWindow: 1_000_000,
              contextTokens: inputTokens + outputTokens,
              percentage: Math.round(((inputTokens + outputTokens) / 1_000_000) * 100),
            },
          });
        }
        break;
      }

      default:
        // Unknown event types are silently ignored
        break;
    }

    return chunks;
  }



  private execCliCommand(
    cliPath: string,
    args: string[],
  ): Promise<{ exitCode: number; stdout: string }> {
    return new Promise((resolve) => {
      const proc = spawn(cliPath, args, {
        env: this.buildEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout });
      });

      proc.on('error', () => {
        resolve({ exitCode: 1, stdout: '' });
      });

      // Timeout after 10 seconds for version check
      setTimeout(() => {
        proc.kill();
        resolve({ exitCode: 1, stdout: '' });
      }, 10000);
    });
  }
}
