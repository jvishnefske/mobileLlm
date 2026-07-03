import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { findTool, TOOLS } from '../src/tools';
import { memoryStore, documentStore } from '../src/db';

function tool(name: string) {
  const t = findTool(name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('tool registry', () => {
  it('exposes the expected tools', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'get_time',
      'run_javascript',
      'get_location',
      'device_info',
      'memory',
      'documents',
      'copy_to_clipboard',
      'speak',
    ]);
  });

  it('findTool returns undefined for unknown names', () => {
    expect(findTool('nope')).toBeUndefined();
  });
});

describe('get_time', () => {
  it('returns iso, local, and timezone', async () => {
    const result = JSON.parse(await tool('get_time').run({}));
    expect(new Date(result.iso).getTime()).toBeGreaterThan(0);
    expect(result.timezone).toBeTruthy();
    expect(result.local).toBeTruthy();
  });
});

describe('run_javascript', () => {
  it('evaluates code and returns the last expression', async () => {
    const out = JSON.parse(
      await tool('run_javascript').run({ code: '[1,2,3].map(x => x * 2).join(",")' })
    );
    expect(out.result).toBe('2,4,6');
  });

  it('captures console.log output', async () => {
    const out = JSON.parse(
      await tool('run_javascript').run({ code: 'console.log("a", {b: 1}); 5' })
    );
    expect(out.logs).toEqual(['a {"b":1}']);
    expect(out.result).toBe(5);
  });

  it('is isolated from browser and app APIs', async () => {
    const out = JSON.parse(
      await tool('run_javascript').run({
        code: '[typeof fetch, typeof window, typeof indexedDB, typeof XMLHttpRequest].join()',
      })
    );
    expect(out.result).toBe('undefined,undefined,undefined,undefined');
  });

  it('interrupts infinite loops', async () => {
    await expect(tool('run_javascript').run({ code: 'while(true){}' })).rejects.toThrow(
      /Timed out/
    );
  }, 10000);

  it('surfaces syntax and runtime errors', async () => {
    await expect(tool('run_javascript').run({ code: 'nope.nope()' })).rejects.toThrow();
    await expect(tool('run_javascript').run({ code: '' })).rejects.toThrow(/No code/);
  });
});

describe('memory tool', () => {
  beforeEach(async () => {
    for (const entry of await memoryStore.list()) {
      await memoryStore.delete(entry.key);
    }
  });

  it('saves, gets, lists, and deletes', async () => {
    const memory = tool('memory');
    expect(await memory.run({ action: 'save', key: 'color', text: 'teal' })).toContain(
      'Saved'
    );
    expect(JSON.parse(await memory.run({ action: 'get', key: 'color' }))).toEqual({
      key: 'color',
      text: 'teal',
    });
    expect(JSON.parse(await memory.run({ action: 'list' }))).toEqual(['color']);
    await memory.run({ action: 'delete', key: 'color' });
    expect(await memory.run({ action: 'get', key: 'color' })).toContain('Nothing stored');
    expect(await memory.run({ action: 'list' })).toBe('Memory is empty.');
  });

  it('rejects bad input', async () => {
    const memory = tool('memory');
    await expect(memory.run({ action: 'save', key: 'x' })).rejects.toThrow(/needs/);
    await expect(memory.run({ action: 'explode' })).rejects.toThrow(/action must be/);
  });
});

describe('documents tool', () => {
  beforeEach(async () => {
    for (const doc of await documentStore.list()) {
      await documentStore.delete(doc.name);
    }
  });

  it('lists imported documents with sizes', async () => {
    const documents = tool('documents');
    expect(await documents.run({ action: 'list' })).toContain('No documents');
    await documentStore.save('a.md', 'hello world');
    expect(JSON.parse(await documents.run({ action: 'list' }))).toEqual([
      { name: 'a.md', chars: 11 },
    ]);
  });

  it('reads a document and truncates very long ones', async () => {
    const documents = tool('documents');
    await documentStore.save('short.md', 'small doc');
    expect(await documents.run({ action: 'read', name: 'short.md' })).toBe('small doc');
    await documentStore.save('long.md', 'x'.repeat(10000));
    const long = await documents.run({ action: 'read', name: 'long.md' });
    expect(long.length).toBeLessThan(7000);
    expect(long).toContain('truncated');
    await expect(documents.run({ action: 'read', name: 'ghost.md' })).rejects.toThrow(
      /No document/
    );
  });

  it('searches by keyword with ranked snippets', async () => {
    const documents = tool('documents');
    await documentStore.save('trip.md', 'Hotel Azul is $148/night near the beach.');
    await documentStore.save('work.md', 'Standup at 9am. Hotel expense policy: none.');
    const hits = JSON.parse(await documents.run({ action: 'search', query: 'hotel azul' }));
    expect(hits[0].name).toBe('trip.md'); // two term hits outrank one
    expect(hits[0].snippet).toContain('Hotel Azul');
    expect(await documents.run({ action: 'search', query: 'zeppelin' })).toContain(
      'No documents match'
    );
    await expect(documents.run({ action: 'search', query: '  ' })).rejects.toThrow(
      /Empty search/
    );
  });
});
