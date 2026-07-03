import { Wllama, type WllamaChatMessage } from '@wllama/wllama';
import wasmSingle from '@wllama/wllama/esm/single-thread/wllama.wasm?url';
import wasmMulti from '@wllama/wllama/esm/multi-thread/wllama.wasm?url';

export interface ModelOption {
  name: string;
  size: string;
  url: string;
}

// Small instruction-tuned GGUF models that are practical on phones.
// All are fetched directly from Hugging Face by the browser and cached
// on-device, so the second load works fully offline.
export const MODELS: ModelOption[] = [
  {
    name: 'SmolLM2 360M Instruct (recommended)',
    size: '~270 MB',
    url: 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf',
  },
  {
    name: 'SmolLM2 135M Instruct (fastest)',
    size: '~145 MB',
    url: 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q8_0.gguf',
  },
  {
    name: 'Qwen2.5 0.5B Instruct (smartest)',
    size: '~400 MB',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  },
];

export type ProgressFn = (loaded: number, total: number) => void;
export type TokenFn = (currentText: string) => void;

export class LlmEngine {
  private wllama: Wllama | null = null;
  modelUrl: string | null = null;

  get isLoaded(): boolean {
    return this.wllama?.isModelLoaded() ?? false;
  }

  async load(url: string, onProgress: ProgressFn): Promise<void> {
    await this.unload();
    const wllama = new Wllama(
      {
        'single-thread/wllama.wasm': wasmSingle,
        'multi-thread/wllama.wasm': wasmMulti,
      },
      {
        // Serve from the on-device cache when the network is gone.
        allowOffline: true,
        suppressNativeLog: true,
      }
    );
    await wllama.loadModelFromUrl(url, {
      n_ctx: 2048,
      progressCallback: ({ loaded, total }) => onProgress(loaded, total),
    });
    this.wllama = wllama;
    this.modelUrl = url;
  }

  async unload(): Promise<void> {
    if (this.wllama) {
      try {
        await this.wllama.exit();
      } catch {
        /* already gone */
      }
      this.wllama = null;
      this.modelUrl = null;
    }
  }

  async chat(
    messages: WllamaChatMessage[],
    onToken: TokenFn,
    abortSignal?: AbortSignal
  ): Promise<string> {
    if (!this.wllama) throw new Error('No model loaded');
    return await this.wllama.createChatCompletion(messages, {
      nPredict: 512,
      abortSignal,
      sampling: {
        temp: 0.4,
        top_p: 0.9,
        penalty_repeat: 1.15,
      },
      onNewToken: (_token, _piece, currentText) => onToken(currentText),
    });
  }
}
