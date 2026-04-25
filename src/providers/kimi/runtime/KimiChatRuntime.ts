import { type ChildProcess, spawn } from 'child_process';
import { Platform } from 'obsidian';

import type { ProviderCapabilities } from '../../../core/providers/types';
import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
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
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { KIMI_PROVIDER_CAPABILITIES } from '../capabilities';
import { getKimiProviderSettings } from '../settings';

export class KimiChatRuntime implements ChatRuntime {
  readonly providerId = 'kimi';
  private plugin: ClaudianPlugin;
  private currentProcess: ChildProcess | null = null;
  private cancelled = false;
  private ready = false;
  private hiddenToolIds = new Set<string>();
  private readyListeners: Set<(ready: boolean) => void> = new Set();
  private turnMetadata: ChatTurnMetadata = {};
  private currentSessionId: string | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return KIMI_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    const sections: string[] = [];
    sections.push(request.text);

    if (request.currentNotePath) {
      sections.push(`\n[Current note: ${request.currentNotePath}]`);
    }

    if (request.editorSelection?.selectedText) {
      sections.push(
        `\n[Editor selection from ${request.editorSelection.notePath || 'current note'}:\n${request.editorSelection.selectedText}\n]`,
      );
    }

    if (request.browserSelection?.selectedText) {
      sections.push(
        `\n[Browser selection from ${request.browserSelection.url ?? 'unknown page'}:\n${request.browserSelection.selectedText}\n]`,
      );
    }

    if (request.canvasSelection) {
      const nodeList = request.canvasSelection.nodeIds.join(', ');
      if (nodeList) {
        sections.push(
          `\n[Canvas selection from ${request.canvasSelection.canvasPath}:\n${nodeList}\n]`,
        );
      }
    }

    const prompt = sections.join('');

    return {
      request,
      persistedContent: request.text,
      prompt,
      isCompact: false,
      mcpMentions: new Set(),
    };
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const data = { ...this.turnMetadata };
    this.turnMetadata = {};
    return data;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    if (!this.ready) {
      this.ready = true;
      this.readyListeners.forEach(l => l(true));
      return true;
    }
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.cancelled = false;
    this.goalNoticeEmitted = false;
    const cliPath = this.resolveCliPath();
    if (!cliPath) {
      yield { type: 'error', content: 'Kimi CLI not found. Please install it with: uv tool install kimi-cli' };
      yield { type: 'done' };
      return;
    }

    const vaultPath = getVaultPath(this.plugin.app);
    const args = [
      '-p', turn.prompt,
      '--print',
      '--output-format', 'stream-json',
      '--yolo',
    ];

    // Resume existing Kimi native session for multi-turn continuity
    if (this.currentSessionId) {
      args.push('--session', this.currentSessionId);
    }

    const env = this.buildEnvironment();

    // Detect slash commands (skills, flows, etc.) and emit a premium skill notice
    const slashMatch = turn.prompt.match(/^\/([^\s]+)/);
    if (slashMatch) {
      const commandName = slashMatch[1];
      const toolId = `skill-trigger-${Date.now()}`;
      yield { type: 'tool_use', id: toolId, name: 'Skill', input: { skill: commandName } };
      yield { type: 'tool_result', id: toolId, content: 'Skill triggered' };
    }

    yield { type: 'assistant_message_start' };

    const process = spawn(cliPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: vaultPath || undefined,
    });
    this.currentProcess = process;

    // Kimi's python CLI blocks indefinitely if stdin is left open, expecting piped input
    process.stdin?.end();

    let buffer = '';
    let hasResponse = false;
    let spawnError: Error | null = null;
    let stderrBuffer = '';
    let unparseableStdout = '';

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

        buffer += chunk;
        let newlineIndex: number;

        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) continue;

          try {
            const event = JSON.parse(line);
            event._originalPrompt = turn.prompt;
            for (const streamChunk of this.mapEventToStreamChunks(event)) {
              if (streamChunk.type === 'text' || streamChunk.type === 'thinking') hasResponse = true;
              yield streamChunk;
            }
          } catch (e) {
            console.warn(`[KimiProvider] Failed to parse JSON line: ${line}`, e);
            unparseableStdout += line + '\n';
          }
        }
      }

      const trimBuf = buffer.trim();
      if (trimBuf && !this.cancelled) {
        try {
          const event = JSON.parse(trimBuf);
          for (const streamChunk of this.mapEventToStreamChunks(event)) {
            if (streamChunk.type === 'text' || streamChunk.type === 'thinking') hasResponse = true;
            yield streamChunk;
          }
        } catch (e) {
          console.warn(`[KimiProvider] Failed to parse residual JSON: ${trimBuf}`, e);
          unparseableStdout += trimBuf + '\n';
        }
      }

      if (spawnError) {
        yield { type: 'error', content: `Failed to start Kimi CLI: ${(spawnError as Error).message}. Please ensure the CLI path is correctly configured in settings or that 'kimi' is in your PATH.` };
      } else if (!hasResponse && !this.cancelled) {
        let msg = 'No response received from Kimi CLI.';
        
        const hints = [stderrBuffer.trim(), unparseableStdout.trim()].filter(Boolean).join('\n');
        if (hints) {
           msg += `\n\nDetails:\n${hints}`;
        }
        if (hints.includes('LLM not set')) {
           msg += `\n\nHint: Have you authenticated? Try running 'kimi login' in your local terminal.`;
        }
        yield { type: 'error', content: msg };
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown execution error';
      yield { type: 'error', content: message };
    } finally {
      // Capture native Kimi session ID from stdout/stderr output
      const combinedOutput = unparseableStdout + '\n' + stderrBuffer;
      const sessionMatch = combinedOutput.match(/kimi -r ([\w-]+)/);
      if (sessionMatch?.[1]) {
        this.currentSessionId = sessionMatch[1];
      }

      this.cleanupProcess();
      yield { type: 'done' };
    }
  }

  private goalNoticeEmitted = false;

  private mapEventToStreamChunks(event: Record<string, any>): StreamChunk[] {
    const chunks: StreamChunk[] = [];

    // Emit a goal notice once per turn if not a slash command (which already has a notice)
    // We do this when we receive the first valid event from Kimi
    if (!this.goalNoticeEmitted && (event.role === 'assistant' || event.content || event.type === 'PlanDisplay')) {
       const prompt = event._originalPrompt || '';
       if (!prompt.startsWith('/')) {
         const firstLine = prompt.split('\n')[0].slice(0, 100);
         chunks.push({
           type: 'notice',
           content: `🎯 **Task**: ${firstLine}${prompt.length > 100 ? '...' : ''}`,
           level: 'info'
         });
         this.goalNoticeEmitted = true;
       }
    }

    // Assistant message — may contain content (text/think) and tool_calls
    if (event.role === 'assistant') {
      if (Array.isArray(event.content)) {
        for (const part of event.content) {
          if (part.type === 'think' && part.think) {
            chunks.push({ type: 'thinking', content: part.think });

            // DEBUG: Log Kimi's thoughts to help refine the heuristic
            console.log(`[KimiThinking] ${part.think}`);

            // HEURISTIC: Extract skill name from thinking block (Aggressive Regex)
            // Matches: "skill: name", "技能叫 name", "使用 name 技能", "运行技能: name", "调用 xxx", etc.
            const skillMatch = part.think.match(/(?:skill|技能|flow|流程|任务|目标|使用|运行|识别到|调用|加载|执行|invoke|load)[\s:：`"“'‘]*([\w\-_]+)/i) || 
                               part.think.match(/([\w\-_]+)[\s:：`"“'‘]*(?:skill|技能|flow|流程)/i);
            
            const candidate = skillMatch?.[1]?.toLowerCase();
            const isInvalid = !candidate || 
                              /^\d+$/.test(candidate) || 
                              candidate.length < 2 ||
                              ['the', 'to', 'a', 'an', 'my', 'your', 'this', 'skill', 'it', 'that', 'and', 'with'].includes(candidate);

            if (skillMatch?.[1] && !isInvalid) {
              const skillName = skillMatch[1];
              const toolId = `skill-detected-${Date.now()}`;
              chunks.push({
                type: 'tool_use',
                id: toolId,
                name: 'Skill',
                input: { skill: skillName }
              });
              chunks.push({
                type: 'tool_result',
                id: toolId,
                content: 'Skill detected and active'
              });
            }
          } else if (part.type === 'text' && part.text) {
            chunks.push({ type: 'text', content: part.text });
          }
        }
      }

      // Emit tool_use chunks for any tool_calls in the assistant message
      if (Array.isArray(event.tool_calls)) {
        for (const tc of event.tool_calls) {
          const fn = tc.function ?? tc;
          let toolName = fn.name ?? 'unknown_tool';
          const toolId = tc.id ?? `kimi-tool-${Date.now()}`;
          let input: Record<string, unknown> = {};
          try {
            input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? {});
          } catch {
            input = { raw: fn.arguments };
          }

          // TOOL MAPPING: Convert Kimi CLI names to standard Claudian names for premium icons
          if (toolName === 'Shell') toolName = TOOL_BASH;
          if (toolName === 'ReadFile') toolName = TOOL_READ;
          if (toolName === 'WriteFile') toolName = TOOL_WRITE;
          if (toolName === 'StrReplaceFile') toolName = TOOL_EDIT;
          if (toolName === 'GrepLocal') toolName = TOOL_GREP;
          if (toolName === 'Glob') toolName = TOOL_GLOB;
          if (toolName === 'SearchWeb') toolName = TOOL_WEB_SEARCH;
          if (toolName === 'FetchWeb') toolName = TOOL_WEB_FETCH;

          // PARAMETER MAPPING: Convert 'path' to 'file_path' for UI summary display
          if (input.path && !input.file_path) {
            input.file_path = input.path;
          }

          // HIDE INTERNAL SKILL TOOLS (Filtering)
          const filePath = String(input.file_path || input.path || '').toLowerCase();
          if (filePath.endsWith('skill.md') || filePath.includes('.claude/skills/')) {
            this.hiddenToolIds.add(toolId);
            
            // Fallback Detection: If we are reading a skill file, it's a strong hint for the active skill
            const skillFileMatch = filePath.match(/\.claude\/skills\/([\w\-_]+)\.md$/);
            if (skillFileMatch) {
                const skillName = skillFileMatch[1];
                const autoToolId = `skill-auto-${Date.now()}`;
                chunks.push({ type: 'tool_use', id: autoToolId, name: 'Skill', input: { skill: skillName } });
                chunks.push({ type: 'tool_result', id: autoToolId, content: 'Skill auto-detected' });
            }
            continue; 
          }

          chunks.push({ type: 'tool_use', id: toolId, name: toolName, input });
        }
      }

      // Filter out tool_results for hidden tools
      if (event.type === 'tool_result' && event.tool_call_id && this.hiddenToolIds.has(event.tool_call_id)) {
        return [];
      }

      return chunks;
    }

    // ToolResult message from Kimi CLI (role: "tool")
    if (event.role === 'tool' && event.tool_call_id) {
      if (this.hiddenToolIds.has(event.tool_call_id)) return [];
      const content = typeof event.content === 'string'
        ? event.content
        : JSON.stringify(event.content ?? '');
      chunks.push({
        type: 'tool_result',
        id: event.tool_call_id,
        content: content.slice(0, 500), // Truncate long results for display
        isError: event.is_error === true,
      });
      return chunks;
    }

    // Notification events (emit as notice)
    if (event.body && (event.title || event.type)) {
      const title = event.title || event.type || 'System Notice';
      chunks.push({
        type: 'notice',
        content: `**${title}**: ${event.body}`,
        level: event.severity === 'error' ? 'warning' : 'info',
      });
    }

    // PlanDisplay events (emit as notice now for better visibility)
    if (event.content && event.file_path) {
      chunks.push({
        type: 'notice',
        content: `📋 **Current Plan** (${event.file_path})\n\n${event.content}`,
        level: 'info'
      });
    }

    if (event.type === 'error') {
      return [{ type: 'error', content: event.message || JSON.stringify(event) }];
    }

    return chunks;
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanupProcess();
  }

  private cleanupProcess(): void {
    if (this.currentProcess) {
      if (!this.currentProcess.killed) {
        this.currentProcess.kill('SIGINT');
      }
      this.currentProcess = null;
    }
  }

  resetSession(): void {
    this.currentSessionId = null;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  consumeSessionInvalidation(): boolean { return false; }
  setResumeCheckpoint(): void {}

  syncConversationState(
    conversation?: Conversation | null,
    _externalContextPaths?: string[],
  ): void {
    // Restore session ID from loaded conversation
    if (conversation?.sessionId) {
      this.currentSessionId = conversation.sessionId;
    } else if (!conversation) {
      this.currentSessionId = null;
    }
  }

  reloadMcpServers(): Promise<void> { return Promise.resolve(); }
  cleanup(): void { this.cancel(); }
  async rewind(): Promise<ChatRewindResult> { return { canRewind: false, error: 'Not supported' }; }
  setApprovalCallback(): void {}
  setApprovalDismisser(): void {}
  setAskUserQuestionCallback(): void {}
  setExitPlanModeCallback(): void {}
  setPermissionModeSyncCallback(): void {}
  setSubagentHookProvider(): void {}
  setAutoTurnCallback(): void {}

  buildSessionUpdates(_params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return { updates: {} };
  }

  resolveSessionIdForFork(_conversation: Conversation | null): string | null {
    return null;
  }

  async steer(): Promise<boolean> { return false; }
  async getSupportedCommands(): Promise<SlashCommand[]> { return []; }

  private resolveCliPath(): string | null {
    const settings = getKimiProviderSettings(this.plugin.settings as Record<string, unknown>);
    const hostnameKey = require('../../../utils/env').getHostnameKey();
    if (settings.cliPathsByHost?.[hostnameKey]) return settings.cliPathsByHost[hostnameKey];
    if (settings.cliPath) return settings.cliPath;

    return Platform.isWin ? 'kimi.exe' : 'kimi';
  }

  private buildEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const settings = getKimiProviderSettings(
      this.plugin.settings as Record<string, unknown>,
    );

    const customEnvVars = parseEnvironmentVariables(
      this.plugin.getActiveEnvironmentVariables(this.providerId),
    );

    if (settings.environmentVariables) {
      for (const [key, value] of Object.entries(customEnvVars)) {
        env[key] = value;
      }
    }

    env.PATH = getEnhancedPath(env.PATH, this.resolveCliPath() || undefined);

    // Specifically handle ~/.local/bin where uv installs Kimi
    const home = env.HOME || process.env.HOME;
    if (home && !env.PATH.includes(`${home}/.local/bin`)) {
       env.PATH = `${home}/.local/bin:${env.PATH}`;
    }

    env.TERM = 'dumb';
    env.NO_COLOR = '1';

    return env;
  }

}
