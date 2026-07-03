import { describe, it, expect, vi } from 'vitest';
import {
  Agent,
  parseToolCall,
  looksLikeToolAttempt,
  toolCallGrammar,
  type AgentEvents,
} from '../src/agent';
import { TOOLS } from '../src/tools';
import type { LlmEngine } from '../src/llm';

describe('parseToolCall', () => {
  it('parses a well-formed call', () => {
    expect(parseToolCall('TOOL: {"name":"get_time","arguments":{}}')).toEqual({
      name: 'get_time',
      arguments: {},
    });
  });

  it('tolerates leading text and whitespace', () => {
    expect(
      parseToolCall('Sure!\nTOOL:   {"name": "memory", "arguments": {"action": "list"}}')
    ).toEqual({ name: 'memory', arguments: { action: 'list' } });
  });

  it('defaults missing arguments to an empty object', () => {
    expect(parseToolCall('TOOL: {"name":"get_time"}')).toEqual({
      name: 'get_time',
      arguments: {},
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseToolCall('TOOL: {"name": get_time}')).toBeNull();
  });

  it('rejects a non-string name', () => {
    expect(parseToolCall('TOOL: {"name": 42, "arguments": {}}')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseToolCall('The answer is 42.')).toBeNull();
  });
});

describe('looksLikeToolAttempt', () => {
  it('detects a malformed attempt', () => {
    expect(looksLikeToolAttempt('TOOL: {"name": broken')).toBe(true);
  });

  it('is false for a parseable call', () => {
    expect(looksLikeToolAttempt('TOOL: {"name":"get_time","arguments":{}}')).toBe(false);
  });

  it('is false for plain text', () => {
    expect(looksLikeToolAttempt('tools are great')).toBe(false);
  });
});

describe('toolCallGrammar', () => {
  it('includes every tool name plus delegate', () => {
    const grammar = toolCallGrammar();
    for (const tool of TOOLS) {
      expect(grammar).toContain(`\\"${tool.name}\\"`);
    }
    expect(grammar).toContain('\\"delegate\\"');
    expect(grammar).toMatch(/^root ::= /);
  });
});

type ChatCall = {
  messages: { role: string; content: string }[];
  opts?: { grammar?: string; nPredict?: number };
};

// Scripted fake engine: returns queued replies in order and records calls.
function fakeEngine(replies: string[]) {
  const calls: ChatCall[] = [];
  let i = 0;
  const engine = {
    isLoaded: true,
    modelUrl: 'fake',
    async chat(
      messages: ChatCall['messages'],
      onToken: (t: string) => void,
      _signal?: AbortSignal,
      opts?: ChatCall['opts']
    ) {
      calls.push({ messages, opts });
      const reply = replies[Math.min(i++, replies.length - 1)];
      onToken(reply);
      return reply;
    },
  } as unknown as LlmEngine;
  return { engine, calls };
}

function events(): AgentEvents & { toolCalls: string[]; toolResults: string[] } {
  const toolCalls: string[] = [];
  const toolResults: string[] = [];
  return {
    toolCalls,
    toolResults,
    onToken: vi.fn(),
    onToolCall: (name) => toolCalls.push(name),
    onToolResult: (_name, result) => toolResults.push(result),
    onAnswerStart: vi.fn(),
  };
}

describe('Agent.run', () => {
  it('returns a plain reply without touching tools', async () => {
    const { engine, calls } = fakeEngine(['Hello there!']);
    const agent = new Agent(engine);
    const ev = events();
    const reply = await agent.run('hi', true, ev);
    expect(reply).toBe('Hello there!');
    expect(ev.toolCalls).toEqual([]);
    expect(agent.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there!' },
    ]);
    // System prompt advertises tools when enabled.
    expect(calls[0].messages[0].content).toContain('run_javascript');
  });

  it('omits tool instructions when tools are disabled', async () => {
    const { engine, calls } = fakeEngine(['Hi.']);
    await new Agent(engine).run('hi', false, events());
    expect(calls[0].messages[0].content).not.toContain('TOOL:');
  });

  it('executes a tool call and feeds the result back', async () => {
    const { engine, calls } = fakeEngine([
      'TOOL: {"name":"get_time","arguments":{}}',
      'It is late.',
    ]);
    const agent = new Agent(engine);
    const ev = events();
    const reply = await agent.run('what time is it?', true, ev);
    expect(ev.toolCalls).toEqual(['get_time']);
    expect(ev.toolResults[0]).toContain('timezone');
    expect(reply).toBe('It is late.');
    // Second round got the tool result as a user turn.
    const secondRoundMessages = calls[1].messages;
    const toolTurn = secondRoundMessages[secondRoundMessages.length - 1];
    expect(toolTurn.role).toBe('user');
    expect(toolTurn.content).toContain('[tool result for get_time]');
  });

  it('reports unknown tools as errors and continues', async () => {
    const { engine } = fakeEngine([
      'TOOL: {"name":"launch_rocket","arguments":{}}',
      'Sorry, no rockets.',
    ]);
    const ev = events();
    const reply = await new Agent(engine).run('go', true, ev);
    expect(ev.toolResults[0]).toContain('Unknown tool "launch_rocket"');
    expect(reply).toBe('Sorry, no rockets.');
  });

  it('repairs a malformed tool call under grammar constraint', async () => {
    const { engine, calls } = fakeEngine([
      'TOOL: {"name": get_time}', // malformed free-form attempt
      '{"name":"get_time","arguments":{}}', // grammar-constrained repair
      'The time is above.',
    ]);
    const ev = events();
    const reply = await new Agent(engine).run('time?', true, ev);
    expect(ev.toolCalls).toEqual(['get_time']);
    expect(reply).toBe('The time is above.');
    // The repair call used a grammar and a small token budget.
    expect(calls[1].opts?.grammar).toContain('root ::=');
    expect(calls[1].opts?.nPredict).toBe(128);
  });

  it('runs delegate as a fresh focused conversation', async () => {
    const { engine, calls } = fakeEngine([
      'TOOL: {"name":"delegate","arguments":{"task":"write a haiku about rain"}}',
      'drops on the window', // delegate sub-conversation reply
      'Here is your haiku: drops on the window',
    ]);
    const ev = events();
    const reply = await new Agent(engine).run('haiku please', true, ev);
    expect(ev.toolCalls).toEqual(['delegate']);
    expect(ev.toolResults[0]).toBe('drops on the window');
    expect(reply).toContain('haiku');
    // The delegate call had its own 2-message context, not the chat history.
    expect(calls[1].messages).toHaveLength(2);
    expect(calls[1].messages[0].content).toContain('sub-assistant');
    expect(calls[1].messages[1].content).toBe('write a haiku about rain');
  });

  it('stops offering tools after MAX_TOOL_ROUNDS', async () => {
    // Model tries to call a tool every single round.
    const { engine, calls } = fakeEngine(['TOOL: {"name":"get_time","arguments":{}}']);
    const ev = events();
    const reply = await new Agent(engine).run('loop forever', true, ev);
    // 3 tool rounds + 1 final forced-text round.
    expect(ev.toolCalls).toHaveLength(3);
    expect(reply).toBe('TOOL: {"name":"get_time","arguments":{}}');
    // Final round's system prompt no longer offers tools.
    expect(calls[calls.length - 1].messages[0].content).not.toContain('TOOL:');
  });

  it('reset clears history', async () => {
    const { engine } = fakeEngine(['ok']);
    const agent = new Agent(engine);
    await agent.run('hi', false, events());
    agent.reset();
    expect(agent.history).toEqual([]);
  });
});
