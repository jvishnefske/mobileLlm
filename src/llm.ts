import { Wllama, type WllamaChatMessage } from '@wllama/wllama';
import wasmSingle from '@wllama/wllama/esm/single-thread/wllama.wasm?url';
import wasmMulti from '@wllama/wllama/esm/multi-thread/wllama.wasm?url';
import { isIos } from './install';

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
export type AttemptFn = (description: string) => void;

/**
 * WASM memory allocation failed — the device refused the address-space
 * reservation, not a bug in the model or the app.
 */
export function isMemoryError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /allocat|memory|OOM/i.test(msg);
}

export interface LoadAttempt {
  multiThread: boolean;
  n_ctx: number;
  description: string;
}

/**
 * The load strategy ladder. The multi-threaded llama.cpp build must reserve
 * a large SHARED WebAssembly.Memory upfront, which iOS Safari refuses
 * ("Cannot allocate WebAssembly.Memory") even though the page is
 * cross-origin isolated — so iOS starts single-threaded, where memory is
 * unshared and grows on demand. Elsewhere multi-thread is tried first and
 * memory failures walk down the ladder (fewer threads, then smaller
 * context). Model bytes are cached after the first attempt, so retries
 * don't re-download.
 */
export function loadAttempts(preferSingleThread: boolean): LoadAttempt[] {
  const attempts: LoadAttempt[] = [];
  if (!preferSingleThread) {
    attempts.push({ multiThread: true, n_ctx: 2048, description: 'multi-threaded' });
  }
  attempts.push({ multiThread: false, n_ctx: 2048, description: 'single-threaded' });
  attempts.push({ multiThread: false, n_ctx: 1024, description: 'single-threaded, small context' });
  return attempts;
}

export class LlmEngine {
  private wllama: Wllama | null = null;
  modelUrl: string | null = null;
  /** How the loaded model ended up running, e.g. "single-threaded". */
  loadMode: string | null = null;

  get isLoaded(): boolean {
    return this.wllama?.isModelLoaded() ?? false;
  }

  async load(url: string, onProgress: ProgressFn, onAttempt?: AttemptFn): Promise<void> {
    await this.unload();
    const attempts = loadAttempts(isIos());
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      if (i > 0) onAttempt?.(attempt.description);
      const wllama = new Wllama(
        {
          'single-thread/wllama.wasm': wasmSingle,
          // Omitting the multi-thread binary forces the single-thread build.
          ...(attempt.multiThread ? { 'multi-thread/wllama.wasm': wasmMulti } : {}),
        },
        {
          // Serve from the on-device cache when the network is gone.
          allowOffline: true,
          suppressNativeLog: true,
        }
      );
      try {
        await wllama.loadModelFromUrl(url, {
          n_ctx: attempt.n_ctx,
          progressCallback: ({ loaded, total }) => onProgress(loaded, total),
        });
        this.wllama = wllama;
        this.modelUrl = url;
        this.loadMode = attempt.description;
        return;
      } catch (err) {
        try {
          await wllama.exit();
        } catch {
          /* worker never started */
        }
        const isLastAttempt = i === attempts.length - 1;
        if (isLastAttempt || !isMemoryError(err)) throw err;
      }
    }
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
      this.loadMode = null;
    }
  }

  async chat(
    messages: WllamaChatMessage[],
    onToken: TokenFn,
    abortSignal?: AbortSignal,
    opts?: { grammar?: string; nPredict?: number }
  ): Promise<string> {
    if (!this.wllama) throw new Error('No model loaded');
    return await this.wllama.createChatCompletion(messages, {
      nPredict: opts?.nPredict ?? 512,
      abortSignal,
      sampling: {
        temp: 0.4,
        top_p: 0.9,
        penalty_repeat: 1.15,
        // GBNF grammar constrains sampling to syntactically valid output —
        // used to repair malformed tool calls from small models.
        grammar: opts?.grammar,
      },
      onNewToken: (_token, _piece, currentText) => onToken(currentText),
    });
  }
}
