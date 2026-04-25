import type {
  InstructionRefineService,
  RefineProgressCallback,
} from '../../../core/providers/types';
import type {
  InstructionRefineResult,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';

export class KimiInstructionRefineService implements InstructionRefineService {
  constructor(_plugin: ClaudianPlugin) {}

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
