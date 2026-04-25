import type {
  ProviderConversationHistoryService,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

/**
 * Gemini uses headless mode (each query is a separate CLI invocation),
 * so conversation history is managed entirely by Claudian's session storage.
 * There are no native sessions to hydrate or clean up.
 */
export class GeminiConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // No-op: Gemini headless mode has no native session files to replay
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // No-op: no native session files to clean up
  }

  resolveSessionIdForConversation(_conversation: Conversation | null): string | null {
    return null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }
}
