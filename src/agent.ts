import type { WllamaChatMessage } from '@wllama/wllama';
import type { LlmEngine, TokenFn } from './llm';
import { TOOLS, findTool } from './tools';

const MAX_TOOL_ROUNDS = 3;

function systemPrompt(toolsEnabled: boolean): string {
  const base =
    'You are Pocket Agent, a helpful assistant running entirely on the user\'s phone. ' +
    'Be concise and friendly. Answer in plain text.';
  if (!toolsEnabled) return base;
  const toolList = TOOLS.map(
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

  async run(
    userText: string,
    toolsEnabled: boolean,
    events: AgentEvents,
    abortSignal?: AbortSignal
  ): Promise<string> {
    this.history.push({ role: 'user', content: userText });

    for (let round = 0; ; round++) {
      const messages: WllamaChatMessage[] = [
        { role: 'system', content: systemPrompt(toolsEnabled && round < MAX_TOOL_ROUNDS) },
        ...this.history,
      ];
      const reply = (
        await this.engine.chat(messages, events.onToken, abortSignal)
      ).trim();

      const call = toolsEnabled && round < MAX_TOOL_ROUNDS ? parseToolCall(reply) : null;
      if (!call) {
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      this.history.push({ role: 'assistant', content: reply });
      events.onToolCall(call.name, call.arguments);
      const tool = findTool(call.name);
      let result: string;
      let isError = false;
      if (!tool) {
        result = `Unknown tool "${call.name}". Available: ${TOOLS.map((t) => t.name).join(', ')}`;
        isError = true;
      } else {
        try {
          result = await tool.run(call.arguments);
        } catch (err) {
          result = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
          isError = true;
        }
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
