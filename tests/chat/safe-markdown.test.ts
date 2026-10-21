import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { markdownInline, parseMarkdown, safeMarkdownUrl } from '../../apps/web/src/components/safe-markdown';

const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url));

test('Markdown supports paragraphs, headings, lists, quotes, inline emphasis and fenced code', () => {
  const blocks = parseMarkdown('# Plan\n\nMove **Point 1** and *Point 2*; use `m`.\n\n- First\n- Second\n\n3. Confirm\n4. Reject\n\n> Pending only\n\n```ts\nconst x = "<tag>";\n```\n\n---');
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule']);
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, start: 1, items: [[{ kind: 'text', text: 'First' }], [{ kind: 'text', text: 'Second' }]] });
  assert.equal(blocks[3]!.kind === 'list' && blocks[3].start, 3);
  assert.deepEqual(blocks[5], { kind: 'code', language: 'ts', text: 'const x = "<tag>";' });
  assert.deepEqual(markdownInline('**bold** *italic* `code`').map(token => token.kind), ['strong', 'text', 'em', 'text', 'code']);
});

test('only explicit safe external link protocols are admitted, never relative or executable URLs', () => {
  for (const url of ['https://example.com/path?q=1#two', 'http://example.com', 'mailto:help@example.com']) assert.equal(safeMarkdownUrl(url), url);
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,evil', 'vbscript:evil', '//example.com', '/chat/send', '#local', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com\\evil', ' https://example.com', 'java\nscript:alert(1)', 'javascript&#58;alert(1)', 'https://example.com/\u0000']) assert.equal(safeMarkdownUrl(url), undefined, url);
  assert.deepEqual(markdownInline('[bad](javascript:evil)'), [{ kind: 'text', text: '[bad](javascript:evil)' }]);
  assert.deepEqual(markdownInline('![image](https://example.com/tracker.png)'), [{ kind: 'text', text: '![image](https://example.com/tracker.png)' }]);
});

test('partial streamed Markdown and unclosed fences stay readable without dropping text', () => {
  assert.deepEqual(markdownInline('A **pending [link]('), [{ kind: 'text', text: 'A **pending [link](' }]);
  assert.deepEqual(parseMarkdown('```js\n<script>evil</script>'), [{ kind: 'code', text: '<script>evil</script>', language: 'js' }]);
  assert.deepEqual(parseMarkdown('one\r\ntwo'), [{ kind: 'paragraph', children: [{ kind: 'text', text: 'one\ntwo' }] }]);
  assert.equal(parseMarkdown('').length, 0);
});

test('Svelte renderer escapes model HTML and code, rejects images/unsafe links, and renders safe structured Markdown', async () => {
  const { createServer } = await import(webRequire.resolve('vite'));
  const server = await createServer({ root: fileURLToPath(new URL('../../apps/web', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: Component } = await server.ssrLoadModule('/src/components/SafeMarkdown.svelte');
    // Load the renderer through the same Vite module graph as the component.
    const { render } = await server.ssrLoadModule('svelte/server');
    const rendered: string = render(Component, { props: { text: '# Heading\n\n**Bold** *emphasis* `code`\n\n<img src=x onerror=alert(1)><script>alert(1)</script>\n\n[unsafe](javascript:evil) ![image](https://example.com/pixel) [safe](https://example.com)\n\n```html\n</code><svg onload=evil>\n```' } }).body;
    const output = rendered.replace(/<!--[\s\S]*?-->/gu, ''); // Ignore Svelte hydration markers.
    assert.match(output, /<h1[^>]*>Heading<\/h1>/u);
    assert.match(output, /<strong[^>]*>Bold<\/strong>/u);
    assert.match(output, /<em[^>]*>emphasis<\/em>/u);
    assert.match(output, /&lt;img/u); assert.match(output, /&lt;script/u); assert.match(output, /&lt;svg/u);
    assert.ok(!/<(?:img|script|svg)\b/iu.test(output));
    assert.ok(!/href="(?:javascript|data|vbscript):/iu.test(output));
    assert.match(output, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/u);
    assert.equal((output.match(/<a /gu) ?? []).length, 1);
    assert.match(output, /\[unsafe\]\(javascript:evil\)/u);
  } finally { await server.close(); }
});
