// @vitest-environment jsdom
// Tools that touch DOM-adjacent APIs, exercised against jsdom + stubs.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { findTool } from '../src/tools';

describe('copy_to_clipboard', () => {
  it('writes text via the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const result = await findTool('copy_to_clipboard')!.run({ text: 'hello' });
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result).toContain('Copied');
  });
});

describe('speak', () => {
  it('speaks via speechSynthesis', async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        constructor(public text: string) {}
      }
    );
    const result = await findTool('speak')!.run({ text: 'hi there' });
    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0].text).toBe('hi there');
    expect(result).toContain('8 characters');
  });
});

describe('device_info', () => {
  it('reports platform facts as JSON', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const info = JSON.parse(await findTool('device_info')!.run({}));
    expect(info.language).toBeTruthy();
    expect(typeof info.online).toBe('boolean');
    expect(info.installed_as_app).toBe(false);
  });
});
