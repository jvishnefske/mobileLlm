// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('**bold** and `code`\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('renders tables and code blocks', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
  });

  it('strips script tags and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script><b onclick="alert(1)">hi</b>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<b>hi</b>');
  });

  it('strips media and javascript: URLs', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
  });

  it('keeps https links', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
  });
});
