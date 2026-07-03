import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/** Render model-generated markdown to sanitized HTML. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    // Keep it strictly presentational — no media loads, no links executing JS.
    FORBID_TAGS: ['img', 'video', 'audio', 'iframe', 'form', 'input', 'style'],
    ALLOWED_URI_REGEXP: /^https?:/i,
  });
}
