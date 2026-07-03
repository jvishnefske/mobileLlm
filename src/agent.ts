import type { WllamaChatMessage } from '@wllama/wllama';
import type { LlmEngine, TokenFn } from './llm';
import { TOOLS, findTool, type ToolDef } from './tools';

const MAX_TOOL_ROUNDS = 3;

// The delegate subagent is defined here (not tools.ts) because it needs the
// engine: it runs the task in a fresh, focused conversation against the same
// loaded model and returns the result — classic subagent decomposition.
// A short task-specific context often beats dragging the whole chat along.
const DELEGATE: Omit<ToolDef, 'run'> = {
  name: 'delegate',
  description:
    'Delegate a self-contained task (summarize, draft, brainstorm, rewrite) to a ' +
    'focused sub-assistant with a clean context. Include ALL needed text in the task.',
  parameters: '{"task": "<full task description with any input text>"}',
};

const ALL_TOOL_DEFS = [...TOOLS, DELEGATE];

function systemPrompt(toolsEnabled: boolean): string {
  const base =
    'You are Pocket Agent, a helpful assistant running entirely on the user\'s phone. ' +
    'Be concise and friendly. Answer in Markdown.';
  if (!toolsEnabled) return base;
  const toolList = ALL_TOOL_DEFS.map(
    (t) => `- ${t.name}: ${t.description} Arguments: ${t.parameters}`
  ).join('\n');
  return (
    base +
    '\n\nYou can use tools. Available tools:\n' +
    toolList +
    '\n\nTo use a tool, reply with ONLY one line in this exact format:\n' +
    'TOOL: {"name": "<tool_name>", "arguments": {...}}\n' +
    'After the tool result arrives, answer the user using it. ' +
    'Only use a tool when it is needed to answer.'
  );
}

// GBNF grammar forcing a valid call to a known tool — used to regenerate a
// tool call the model botched in free-form output.
export function toolCallGrammar(): string {
  const names = ALL_TOOL_DEFS.map((t) => `"\\"${t.name}\\""`).join(' | ');
  return String.raw`
root ::= "{" ws "\"name\"" ws ":" ws name ws "," ws "\"arguments\"" ws ":" ws object ws "}"
name ::= ${names}
object ::= "{" ws ( pair ( ws "," ws pair )* )? ws "}"
pair ::= string ws ":" ws value
value ::= string | number | "true" | "false" | "null" | object | array
array ::= "[" ws ( value ( ws "," ws value )* )? ws "]"
string ::= "\"" ( [^"\\\x00-\x1f] | "\\" ["\\/bfnrt] )* "\""
number ::= "-"? [0-9]+ ("." [0-9]+)?
ws ::= [ \t\n]*
`.trim();
}

// Matches a tool invocation the model emits, tolerating leading text.
const TOOL_RE = /TOOL:\s*(\{.*\})/s;

export function parseToolCall(
  text: string
): { name: string; arguments: Record<string, unknown> } | null {
  const m = TOOL_RE.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (typeof parsed.name !== 'string') return null;
    return { name: parsed.name, arguments: parsed.arguments ?? {} };
  } catch {
    return null;
  }
}

/** The model tried to call a tool but the JSON didn't parse. */
export function looksLikeToolAttempt(text: string): boolean {
  return /TOOL\s*:/.test(text) && !parseToolCall(text);
}

export interface AgentEvents {
  onToken: TokenFn;
  /** A tool is about to run — lets the UI show it. */
  onToolCall(name: string, args: Record<string, unknown>): void;
  /** A tool finished; result (or error text) is shown to the user. */
  onToolResult(name: string, result: string, isError: boolean): void;
  /** The final assistant answer for this turn is starting. */
  onAnswerStart(): void;
}

export class Agent {
  history: WllamaChatMessage[] = [];

  constructor(private engine: LlmEngine) {}

  reset(): void {
    this.history = [];
  }

  private async runDelegate(task: string, abortSignal?: AbortSignal): Promise<string> {
    if (!task) throw new Error('delegate needs a "task"');
    const messages: WllamaChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a focused sub-assistant. Complete the task directly and concisely. ' +
          'Reply with only the result — no preamble.',
      },
      { role: 'user', content: task },
    ];
    return (await this.engine.chat(messages, () => {}, abortSignal)).trim();
  }

  /** Regenerate a malformed tool call under a JSON grammar constraint. */
  private async repairToolCall(
    abortSignal?: AbortSignal
  ): Promise<{ name: string; arguments: Record<string, unknown> } | null> {
    const messages: WllamaChatMessage[] = [
      { role: 'system', content: systemPrompt(true) },
      ...this.history,
      {
        role: 'user',
        content:
          'Your tool call was malformed. Reply with ONLY the JSON object for the tool call.',
      },
    ];
    try {
      const json = await this.engine.chat(messages, () => {}, abortSignal, {
        grammar: toolCallGrammar(),
        nPredict: 128,
      });
      return parseToolCall('TOOL: ' + json.trim());
    } catch {
      // Repair is best-effort; fall back to showing the raw reply.
      return null;
    }
  }

  async run(
    userText: string,
    toolsEnabled: boolean,
    events: AgentEvents,
    abortSignal?: AbortSignal
  ): Promise<string> {
    this.history.push({ role: 'user', content: userText });

    for (let round = 0; ; round++) {
      const allowTools = toolsEnabled && round < MAX_TOOL_ROUNDS;
      const messages: WllamaChatMessage[] = [
        { role: 'system', content: systemPrompt(allowTools) },
        ...this.history,
      ];
      const reply = (
        await this.engine.chat(messages, events.onToken, abortSignal)
      ).trim();
      this.history.push({ role: 'assistant', content: reply });

      let call = allowTools ? parseToolCall(reply) : null;
      if (!call && allowTools && looksLikeToolAttempt(reply)) {
        call = await this.repairToolCall(abortSignal);
      }
      if (!call) {
        return reply;
      }

      events.onToolCall(call.name, call.arguments);
      let result: string;
      let isError = false;
      try {
        if (call.name === DELEGATE.name) {
          result = await this.runDelegate(String(call.arguments.task ?? ''), abortSignal);
        } else {
          const tool = findTool(call.name);
          if (!tool) {
            throw new Error(
              `Unknown tool "${call.name}". Available: ${ALL_TOOL_DEFS.map((t) => t.name).join(', ')}`
            );
          }
          result = await tool.run(call.arguments);
        }
      } catch (err) {
        result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      events.onToolResult(call.name, result, isError);
      // Small models follow "user" turns far more reliably than injected
      // system turns, so feed the tool result back as a user message.
      this.history.push({
        role: 'user',
        content: `[tool result for ${call.name}]: ${result}\nNow answer my previous question using this result. Do not call another tool unless necessary.`,
      });
      events.onAnswerStart();
    }
  }
}
