import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../../../core/providers/types';
import type {
  InstructionRefineResult,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';

/**
 * Instruction refinement service for Gemini.
 * Initial implementation returns the raw instruction as-is.
 * Future iterations can use Gemini to iteratively refine prompts.
 */
export class GeminiInstructionRefineService implements InstructionRefineService {
  constructor(_plugin: ClaudianPlugin) {
    // Plugin reference reserved for future use
  }

  resetConversation(): void {
    // No-op
  }

  async refineInstruction(
    rawInstruction: string,
    _existingInstructions: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    const result: InstructionRefineResult = {
      success: true,
      refinedInstruction: rawInstruction,
    };
    onProgress?.(result);
    return result;
  }

  async continueConversation(
    _message: string,
    onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    const result: InstructionRefineResult = {
      success: true,
      refinedInstruction: '',
    };
    onProgress?.(result);
    return result;
  }

  cancel(): void {
    // No-op
  }
}
