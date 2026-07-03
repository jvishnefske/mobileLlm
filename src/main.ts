import './style.css';
import { LlmEngine, MODELS } from './llm';
import { Agent } from './agent';
import { setupInstallBanner } from './install';
import { renderMarkdown } from './markdown';
import { documentStore } from './db';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const statusPill = $('status-pill');
const statusText = $('status-text');
const modelSelect = $<HTMLSelectElement>('model-select');
const customUrlRow = $('custom-url-row');
const customUrl = $<HTMLInputElement>('custom-url');
const loadBtn = $<HTMLButtonElement>('load-btn');
const progressWrap = $('progress-wrap');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const modelPanel = $('model-panel');
const chat = $('chat');
const input = $<HTMLTextAreaElement>('input');
const sendBtn = $<HTMLButtonElement>('send-btn');
const toolsToggle = $<HTMLInputElement>('tools-toggle');

const engine = new LlmEngine();
const agent = new Agent(engine);

// ---------- model picker ----------

for (const m of MODELS) {
  const opt = document.createElement('option');
  opt.value = m.url;
  opt.textContent = `${m.name} — ${m.size}`;
  modelSelect.append(opt);
}
const customOpt = document.createElement('option');
customOpt.value = 'custom';
customOpt.textContent = 'Custom GGUF URL…';
modelSelect.append(customOpt);

const savedUrl = localStorage.getItem('model-url');
if (savedUrl) {
  if (MODELS.some((m) => m.url === savedUrl)) {
    modelSelect.value = savedUrl;
  } else {
    modelSelect.value = 'custom';
    customUrl.value = savedUrl;
    customUrlRow.hidden = false;
  }
}

modelSelect.addEventListener('change', () => {
  customUrlRow.hidden = modelSelect.value !== 'custom';
});

function fmtMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
}

function setStatus(text: string, ready = false): void {
  statusText.textContent = text;
  statusPill.classList.toggle('ready', ready);
}

async function loadModel(): Promise<void> {
  const url =
    modelSelect.value === 'custom' ? customUrl.value.trim() : modelSelect.value;
  if (!url) {
    addMsg('error', 'Enter a direct URL to a .gguf file.');
    return;
  }
  loadBtn.disabled = true;
  modelSelect.disabled = true;
  progressWrap.hidden = false;
  setStatus('downloading…');
  try {
    await engine.load(url, (loaded, total) => {
      const pct = total > 0 ? (loaded / total) * 100 : 0;
      progressFill.style.width = pct.toFixed(1) + '%';
      progressLabel.textContent =
        total > 0
          ? `${fmtMB(loaded)} / ${fmtMB(total)} (${pct.toFixed(0)}%) — cached for offline use`
          : `${fmtMB(loaded)} downloaded…`;
    });
    localStorage.setItem('model-url', url);
    // Ask the browser not to evict our data under storage pressure —
    // without this, iOS can silently delete the cached model after
    // ~7 days of disuse.
    void navigator.storage?.persist?.().catch(() => {});
    const name =
      MODELS.find((m) => m.url === url)?.name.split(' (')[0] ??
      url.split('/').pop() ??
      'model';
    setStatus(name, true);
    progressWrap.hidden = true;
    modelPanel.style.display = 'none';
    input.disabled = false;
    sendBtn.disabled = false;
    input.placeholder = 'Ask anything — it runs on your phone';
    input.focus();
    if (chat.childElementCount === 0) {
      addMsg(
        'assistant',
        'Model loaded — I now run fully on this device, even in airplane mode. ' +
          'With tools (🛠) on, I can run code for math and logic, remember things ' +
          'between chats, search documents you import (📎), check the time or your ' +
          'location, copy to the clipboard, and read answers aloud.'
      );
    }
  } catch (err) {
    setStatus('load failed');
    progressWrap.hidden = true;
    addMsg(
      'error',
      `Could not load model: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    loadBtn.disabled = false;
    modelSelect.disabled = false;
  }
}

loadBtn.addEventListener('click', () => void loadModel());

// Tapping the status pill re-opens the model panel to switch models.
statusPill.addEventListener('click', () => {
  modelPanel.style.display = modelPanel.style.display === 'none' ? '' : 'none';
});

// ---------- chat UI ----------

function addMsg(
  kind: 'user' | 'assistant' | 'tool' | 'error',
  text: string
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.textContent = text;
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

let busy = false;

// Keep the screen awake while the model is generating (iOS 16.4+, Android).
async function withWakeLock<T>(fn: () => Promise<T>): Promise<T> {
  let lock: WakeLockSentinel | null = null;
  try {
    lock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
    return await fn();
  } finally {
    void lock?.release().catch(() => {});
  }
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || busy || !engine.isLoaded) return;
  busy = true;
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;
  addMsg('user', text);
  shareBtn.disabled = false; // there is now a chat worth exporting

  let bubble = addMsg('assistant', '');
  bubble.classList.add('thinking');
  const scrollPinned = () => (chat.scrollTop = chat.scrollHeight);

  try {
    const reply = await withWakeLock(() => agent.run(text, toolsToggle.checked, {
      onToken: (current) => {
        // Hide the raw TOOL: line while it streams; the tool bubble shows it.
        bubble.textContent = current.startsWith('TOOL:') ? '…' : current;
        scrollPinned();
      },
      onToolCall: (name, args) => {
        bubble.classList.remove('thinking');
        const argStr = Object.keys(args).length ? ` ${JSON.stringify(args)}` : '';
        bubble.textContent = `Using tool: ${name}`;
        addMsg('tool', `🛠 ${name}${argStr}`);
      },
      onToolResult: (_name, result, isError) => {
        const last = chat.querySelector('.msg.tool:last-of-type');
        if (last) last.textContent += `\n→ ${isError ? '⚠️ ' : ''}${result}`;
        scrollPinned();
      },
      onAnswerStart: () => {
        bubble = addMsg('assistant', '');
        bubble.classList.add('thinking');
      },
    }));
    // Streaming shows plain text; render the finished reply as markdown.
    if (reply && !reply.startsWith('TOOL:')) {
      bubble.classList.add('md');
      bubble.innerHTML = renderMarkdown(reply);
    }
  } catch (err) {
    addMsg(
      'error',
      `Generation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    bubble.classList.remove('thinking');
    if (!bubble.textContent) bubble.remove();
    busy = false;
    sendBtn.disabled = false;
    scrollPinned();
  }
}

sendBtn.addEventListener('click', () => void send());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// ---------- documents ----------

const attachBtn = $<HTMLButtonElement>('attach-btn');
const fileInput = $<HTMLInputElement>('file-input');

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files ?? []);
  fileInput.value = '';
  for (const file of files) {
    try {
      const content = await file.text();
      await documentStore.save(file.name, content);
      addMsg('tool', `📎 imported "${file.name}" (${content.length} chars) — ask me about it`);
    } catch (err) {
      addMsg('error', `Could not import ${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
});

// ---------- share / export chat ----------

const shareBtn = $<HTMLButtonElement>('share-btn');

function chatAsMarkdown(): string {
  const lines = agent.history
    .filter((m) => m.role !== 'system')
    .map((m) => `**${m.role === 'user' ? 'You' : 'Pocket Agent'}:**\n\n${m.content}`);
  return `# Pocket Agent chat\n\n${lines.join('\n\n---\n\n')}\n`;
}

shareBtn.addEventListener('click', async () => {
  if (agent.history.length === 0) return;
  const markdown = chatAsMarkdown();
  const file = new File([markdown], 'pocket-agent-chat.md', {
    type: 'text/markdown',
  });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Pocket Agent chat' });
    } else if (navigator.share) {
      await navigator.share({ title: 'Pocket Agent chat', text: markdown });
    } else {
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pocket-agent-chat.md';
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch {
    /* user cancelled the share sheet */
  }
});

// ---------- offline / install ----------

setupInstallBanner();

window.addEventListener('online', () => setStatus(statusText.textContent ?? '', engine.isLoaded));
window.addEventListener('offline', () => {
  if (!engine.isLoaded) setStatus('offline — cached models still work');
});

if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker
    .register(import.meta.env.BASE_URL + 'sw.js')
    .then(() => {
      // The SW injects COOP/COEP headers (GitHub Pages can't send them),
      // which unlocks SharedArrayBuffer → multi-threaded inference. That
      // only takes effect on a document the SW controlled from the start,
      // so reload once, silently, on the very first visit.
      if (
        !window.crossOriginIsolated &&
        !navigator.serviceWorker.controller &&
        !sessionStorage.getItem('coi-reloaded')
      ) {
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            sessionStorage.setItem('coi-reloaded', '1');
            location.reload();
          },
          { once: true }
        );
      }
    })
    .catch((err) => console.warn('SW registration failed', err));
}
