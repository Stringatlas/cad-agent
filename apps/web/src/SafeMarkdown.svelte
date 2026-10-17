<script lang="ts">
  import { parseMarkdown, type MarkdownInline } from './safe-markdown';
  let { text }: { text: string } = $props();
  const blocks = $derived(parseMarkdown(text));
</script>

{#snippet inline(tokens: MarkdownInline[])}
  {#each tokens as token}
    {#if token.kind === 'text'}{token.text}{:else if token.kind === 'code'}<code>{token.text}</code>
    {:else if token.kind === 'strong'}<strong>{@render inline(token.children)}</strong>
    {:else if token.kind === 'em'}<em>{@render inline(token.children)}</em>
    {:else if token.kind === 'link'}<a href={token.href} target="_blank" rel="noopener noreferrer">{@render inline(token.children)}</a>{/if}
  {/each}
{/snippet}

<div class="markdown" data-testid="safe-markdown">
  {#each blocks as block}
    {#if block.kind === 'paragraph'}<p>{@render inline(block.children)}</p>
    {:else if block.kind === 'heading'}<svelte:element this={`h${block.level}`}>{@render inline(block.children)}</svelte:element>
    {:else if block.kind === 'quote'}<blockquote>{@render inline(block.children)}</blockquote>
    {:else if block.kind === 'code'}<pre><code>{block.text}</code></pre>
    {:else if block.kind === 'list'}
      {#if block.ordered}<ol start={block.start}>{#each block.items as item}<li>{@render inline(item)}</li>{/each}</ol>
      {:else}<ul>{#each block.items as item}<li>{@render inline(item)}</li>{/each}</ul>{/if}
    {:else if block.kind === 'rule'}<hr />{/if}
  {/each}
</div>

<style>
  .markdown { font-size: 13px; line-height: 1.65; color: #ededf2; overflow-wrap: anywhere; }
  .markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; }
  p { margin: .65em 0; white-space: pre-wrap; }
  h1, h2, h3, h4, h5, h6 { font-size: 1.08em; font-weight: 650; line-height: 1.4; margin: 1em 0 .45em; }
  h1 { font-size: 1.25em; } h2 { font-size: 1.15em; }
  strong { font-weight: 650; } a { color: #9dc2ff; text-decoration: underline; text-underline-offset: 2px; }
  a:focus-visible { outline: 2px solid #70a9ff; outline-offset: 2px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; background: #ffffff10; border-radius: 4px; padding: 1px 4px; }
  pre { margin: .8em 0; max-height: 320px; overflow: auto; white-space: pre; background: #131417; border: 1px solid #ffffff12; border-radius: 8px; padding: 10px; }
  pre code { padding: 0; background: transparent; border-radius: 0; }
  ul, ol { margin: .65em 0; padding-left: 1.6em; } li { margin: .25em 0; white-space: pre-wrap; }
  blockquote { white-space: pre-wrap; margin: .8em 0; border-left: 3px solid #7387ac; padding-left: 12px; color: #bebecb; }
  hr { border: 0; border-top: 1px solid #ffffff24; margin: 1em 0; }
</style>
