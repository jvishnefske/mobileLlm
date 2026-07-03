// Device tools the agent can call. Each one uses a web API that is
// available in both Android and iOS browsers. (The `delegate` subagent
// tool lives in agent.ts because it needs the LLM engine itself.)
import { runJavascript } from './sandbox';
import { memoryStore, documentStore } from './db';

export interface ToolDef {
  name: string;
  description: string;
  parameters: string; // human-readable parameter description for the prompt
  run(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Keyword search over imported documents, returning snippets around hits. */
async function searchDocuments(query: string): Promise<string> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error('Empty search query');
  const docs = await documentStore.list();
  const hits: { name: string; score: number; snippet: string }[] = [];
  for (const doc of docs) {
    const lower = doc.content.toLowerCase();
    let score = 0;
    let firstIdx = -1;
    for (const term of terms) {
      let idx = lower.indexOf(term);
      while (idx !== -1) {
        score++;
        if (firstIdx === -1) firstIdx = idx;
        idx = lower.indexOf(term, idx + term.length);
      }
    }
    if (score > 0) {
      const start = Math.max(0, firstIdx - 80);
      const snippet = doc.content.slice(start, firstIdx + 160).replace(/\s+/g, ' ').trim();
      hits.push({ name: doc.name, score, snippet: `…${snippet}…` });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length === 0) return `No documents match "${query}".`;
  return JSON.stringify(hits.slice(0, 5));
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_time',
    description: 'Get the current local date and time on this device.',
    parameters: 'none',
    async run() {
      const now = new Date();
      return JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
  },
  {
    name: 'run_javascript',
    description:
      'Run JavaScript in a secure sandbox and get the result plus console.log output. ' +
      'Use this for ALL math, date calculations, string processing, and logic. ' +
      'The last expression is the result. No network or browser APIs.',
    parameters: '{"code": "<javascript code>"}',
    async run(args) {
      const code = str(args.code);
      if (!code) throw new Error('No code provided');
      return await runJavascript(code);
    },
  },
  {
    name: 'get_location',
    description:
      'Get the device GPS position (latitude/longitude). The user will see a permission prompt.',
    parameters: 'none',
    async run() {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 15000,
          maximumAge: 60000,
        })
      );
      return JSON.stringify({
        latitude: pos.coords.latitude.toFixed(5),
        longitude: pos.coords.longitude.toFixed(5),
        accuracy_m: Math.round(pos.coords.accuracy),
      });
    },
  },
  {
    name: 'device_info',
    description:
      'Get information about this device: platform, language, online/offline state, screen, memory, storage usage.',
    parameters: 'none',
    async run() {
      const nav = navigator as Navigator & { deviceMemory?: number };
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      return JSON.stringify({
        platform: nav.platform || 'unknown',
        userAgent: nav.userAgent,
        language: nav.language,
        online: nav.onLine,
        screen: `${screen.width}x${screen.height}`,
        cpu_cores: nav.hardwareConcurrency,
        device_memory_gb: nav.deviceMemory ?? 'unknown',
        installed_as_app: matchMedia('(display-mode: standalone)').matches,
        storage_used_mb: estimate?.usage ? Math.round(estimate.usage / 1e6) : 'unknown',
        storage_quota_mb: estimate?.quota ? Math.round(estimate.quota / 1e6) : 'unknown',
      });
    },
  },
  {
    name: 'memory',
    description:
      'Persistent memory that survives across chats. Actions: ' +
      '"save" (key + text), "get" (key), "list" (all keys), "delete" (key). ' +
      'Save things the user asks you to remember; check it when asked about the past.',
    parameters: '{"action": "save|get|list|delete", "key": "<short-name>", "text": "<content, for save>"}',
    async run(args) {
      const action = str(args.action);
      const key = str(args.key);
      switch (action) {
        case 'save': {
          if (!key || !str(args.text)) throw new Error('save needs "key" and "text"');
          await memoryStore.save(key, str(args.text));
          return `Saved "${key}".`;
        }
        case 'get': {
          const entry = await memoryStore.get(key);
          return entry
            ? JSON.stringify({ key: entry.key, text: entry.text })
            : `Nothing stored under "${key}".`;
        }
        case 'list': {
          const all = await memoryStore.list();
          return all.length
            ? JSON.stringify(all.map((e) => e.key))
            : 'Memory is empty.';
        }
        case 'delete': {
          await memoryStore.delete(key);
          return `Deleted "${key}".`;
        }
        default:
          throw new Error('action must be save, get, list, or delete');
      }
    },
  },
  {
    name: 'documents',
    description:
      'Access documents the user imported (📎 button). Actions: ' +
      '"list" (all names), "read" (name), "search" (query — keyword search with snippets).',
    parameters: '{"action": "list|read|search", "name": "<for read>", "query": "<for search>"}',
    async run(args) {
      const action = str(args.action);
      switch (action) {
        case 'list': {
          const docs = await documentStore.list();
          return docs.length
            ? JSON.stringify(docs.map((d) => ({ name: d.name, chars: d.content.length })))
            : 'No documents imported yet. The user can add some with the 📎 button.';
        }
        case 'read': {
          const doc = await documentStore.get(str(args.name));
          if (!doc) throw new Error(`No document named "${str(args.name)}"`);
          // Keep within the model's small context window.
          return doc.content.length > 6000
            ? doc.content.slice(0, 6000) + `\n…[truncated, ${doc.content.length} chars total]`
            : doc.content;
        }
        case 'search':
          return await searchDocuments(str(args.query));
        default:
          throw new Error('action must be list, read, or search');
      }
    },
  },
  {
    name: 'copy_to_clipboard',
    description: 'Copy text to the device clipboard.',
    parameters: '{"text": "<text to copy>"}',
    async run(args) {
      await navigator.clipboard.writeText(str(args.text));
      return 'Copied to clipboard.';
    },
  },
  {
    name: 'speak',
    description: 'Read text aloud using the device text-to-speech voice.',
    parameters: '{"text": "<text to speak>"}',
    async run(args) {
      const text = str(args.text);
      if (!('speechSynthesis' in window)) throw new Error('Speech not supported here');
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language;
      speechSynthesis.speak(utterance);
      return `Speaking ${text.length} characters aloud.`;
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
