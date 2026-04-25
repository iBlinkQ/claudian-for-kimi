import type {
  ProviderConversationHistoryService,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';

/**
 * Kimi uses headless mode (each query is a separate CLI invocation),
 * so conversation history is managed entirely by Claudian's session storage.
 * There are no native sessions to hydrate or clean up.
 */
export class KimiConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // If messages are already loaded, skip
    if (conversation.messages.length > 0) {
      return;
    }

    // Restore from persisted providerState if available
    const state = conversation.providerState;
    if (state && Array.isArray(state.messages)) {
      conversation.messages = [...state.messages];
    }
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // No-op: we rely on Claudian's session deletion to clear the meta file
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
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

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return {
      ...conversation.providerState,
      messages: conversation.messages,
    };
  }
}
