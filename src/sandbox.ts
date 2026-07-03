// Sandboxed JavaScript execution for the agent's run_javascript tool.
// QuickJS compiled to WASM: no DOM, no network, no access to app storage,
// with hard memory and wall-clock limits. This is a real sandbox, unlike
// eval()/Function() which would run with full page authority.
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';

const MEMORY_LIMIT = 32 * 1024 * 1024;
const TIME_LIMIT_MS = 2000;

let modulePromise: Promise<QuickJSWASMModule> | null = null;

export async function runJavascript(code: string): Promise<string> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  const QuickJS = await modulePromise;

  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + TIME_LIMIT_MS;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const ctx = runtime.newContext();

  const logs: string[] = [];
  const logFn = ctx.newFunction('log', (...args) => {
    logs.push(
      args
        .map((a) => {
          const v = ctx.dump(a);
          return typeof v === 'string' ? v : JSON.stringify(v);
        })
        .join(' ')
    );
  });
  const consoleObj = ctx.newObject();
  ctx.setProp(consoleObj, 'log', logFn);
  ctx.setProp(ctx.global, 'console', consoleObj);
  logFn.dispose();
  consoleObj.dispose();

  try {
    const result = ctx.evalCode(code);
    if ('error' in result && result.error) {
      const err = ctx.dump(result.error);
      result.error.dispose();
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? `${err.name ?? 'Error'}: ${err.message}`
          : String(err);
      throw new Error(msg === 'InternalError: interrupted' ? `Timed out after ${TIME_LIMIT_MS}ms` : msg);
    }
    const value = ctx.dump(result.value);
    result.value.dispose();
    return JSON.stringify({
      result: value === undefined ? null : value,
      logs,
    });
  } finally {
    ctx.dispose();
    runtime.dispose();
  }
}
