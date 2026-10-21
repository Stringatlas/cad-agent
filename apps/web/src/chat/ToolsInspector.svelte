<script lang="ts">
  import { onMount } from 'svelte';
  import type { AgentToolsInspection } from '../../../../packages/contracts/src/agent-tools-inspection';
  import { fetchAgentToolsInspection, filterAgentTools } from './agent-tools-client';

  let inspection = $state<AgentToolsInspection>();
  let loading = $state(true), failed = $state(false), search = $state('');
  let active: AbortController | undefined;
  const tools = $derived(filterAgentTools(inspection?.tools ?? [], search));

  async function load() {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    loading = true; failed = false;
    const timer = setTimeout(() => controller.abort(), 10000);
    try { inspection = await fetchAgentToolsInspection(controller.signal); }
    catch { if (active === controller) failed = true; }
    finally { clearTimeout(timer); if (active === controller) loading = false; }
  }
  onMount(() => { void load(); return () => { const previous = active; active = undefined; previous?.abort(); }; });
</script>

<svelte:head><title>Tools · Spatial</title><meta name="description" content="Inspect the registered product-agent tools, shared instructions and runtime skills." /></svelte:head>
<header><a href="/">← Back to workspace</a><span>Spatial</span></header>
<main>
  <h1>Agent tools</h1>
  <p class="intro">The full registered catalog, not live availability for your scene.</p>
  <nav aria-label="Inspector sections"><a href="#tools">Tools</a><a href="#instructions">Instructions</a><a href="#skills">Runtime skills</a></nav>

  {#if loading}<p role="status">Loading tools…</p>
  {:else if failed}<div class="error" role="alert"><p>Couldn’t load the tools catalog. Check that the local server is running.</p><button onclick={() => void load()}>Retry</button></div>
  {:else if inspection}
    <section id="tools" aria-labelledby="tools-title">
      <h2 id="tools-title">Registered tools</h2>
      <label for="tool-search">Search tools</label>
      <input id="tool-search" type="search" bind:value={search} placeholder="Name, description or requirement" />
      <p class="count" role="status">{tools.length} of {inspection.tools.length} tools</p>
      {#each tools as tool}
        <details class="entry">
          <summary><code>{tool.namespace}.{tool.name}</code></summary>
          <div class="entry-body">
            <p>{tool.description}</p>
            <h3>Requirements</h3>
            {#if tool.requirements.length}<ul>{#each tool.requirements as requirement}<li>{requirement}</li>{/each}</ul>{:else}<p>No additional registry requirements.</p>{/if}
            <dl><div><dt>Runtime skill</dt><dd>{tool.skillId ?? 'Core tool'}</dd></div><div><dt>Strict schema</dt><dd>{tool.strict ? 'Yes' : 'No'}</dd></div></dl>
            <h3>Full parameter schema</h3>
            <!-- Focusable scroll region lets keyboard users inspect long schemas. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre role="region" tabindex="0" aria-label={`${tool.name} parameter schema`}>{JSON.stringify(tool.parameters, null, 2)}</pre>
          </div>
        </details>
      {:else}<p>No tools match “{search}”.</p>{/each}
    </section>
    <section id="instructions" aria-labelledby="instructions-title">
      <h2 id="instructions-title">Shared instructions</h2>
      <p>Unbound preview, not an actual provider request. Scene context, images and loaded skills vary by turn. In chat, open the request inspector to see the outgoing request for each round.</p>
      <details class="entry"><summary>Full instruction preview</summary><div class="entry-body">
        <!-- Focusable scroll region supports keyboard reading of full instructions. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <pre class="prose" role="region" tabindex="0" aria-label="Shared instruction preview">{inspection.instructions.text}</pre>
      </div></details>
    </section>
    <section id="skills" aria-labelledby="skills-title">
      <h2 id="skills-title">Runtime skills</h2>
      <p>Available skill bodies. These are loaded on demand, not all included in every turn.</p>
      {#each inspection.skills as skill}
        <details class="entry">
          <summary>{skill.name}</summary>
          <div class="entry-body">
            <p>{skill.description}</p>
            <dl><div><dt>ID</dt><dd><code>{skill.id}</code></dd></div><div><dt>Scene modes</dt><dd>{skill.modes.join(', ') || 'None'}</dd></div><div><dt>Tools</dt><dd>{skill.tools.join(', ') || 'None'}</dd></div><div><dt>Dependencies</dt><dd>{skill.dependencies.join(', ') || 'None'}</dd></div></dl>
            <h3>Full skill instructions</h3>
            <!-- Focusable scroll region supports keyboard reading of full instructions. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre class="prose" role="region" tabindex="0" aria-label={`${skill.name} instructions`}>{skill.instructions}</pre>
          </div>
        </details>
      {/each}
    </section>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #151619; color: #f2f2f5; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  :global(:is(a, button, input, summary, pre):focus-visible) { outline: 2px solid #8bb8ff; outline-offset: 3px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; min-height: 64px; padding: 10px max(20px, calc((100% - 940px) / 2)); border-bottom: 1px solid #ffffff18; }
  header span { color: #b9bbc4; }
  a { color: #b6d1ff; text-underline-offset: 4px; }
  header a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }
  main { max-width: 940px; margin: 0 auto; padding: 36px 20px 80px; }
  h1 { font-size: 30px; letter-spacing: -.8px; line-height: 1.2; margin: 0 0 12px; }
  h2 { font-size: 20px; margin: 0 0 14px; letter-spacing: -.3px; }
  h3 { font-size: 14px; margin: 22px 0 8px; }
  p { color: #b9bbc4; margin: 0 0 18px; }
  .intro { font-size: 16px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 22px 0; }
  nav a { display: inline-flex; align-items: center; min-height: 44px; }
  section { margin-top: 32px; scroll-margin-top: 20px; }
  label { display: block; margin-bottom: 8px; }
  input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #555760; border-radius: 8px; background: #202124; color: inherit; font: inherit; }
  .count { font-size: 12px; margin: 10px 0 14px; }
  .entry { border: 1px solid #ffffff20; border-radius: 9px; margin: 10px 0; overflow-wrap: anywhere; }
  summary { padding: 13px 16px; min-height: 48px; cursor: pointer; }
  summary:hover { background: #ffffff06; }
  .entry-body { padding: 4px 16px 18px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  pre { background: #101114; border-radius: 6px; padding: 16px; overflow: auto; max-height: 65vh; margin: 0; line-height: 1.7; }
  .prose { white-space: pre-wrap; overflow-wrap: anywhere; }
  dl { margin: 18px 0; } dl div { display: grid; grid-template-columns: 125px minmax(0, 1fr); gap: 12px; margin: 6px 0; }
  dt { color: #b9bbc4; } dd { margin: 0; } ul { padding-left: 20px; }
  button { min-height: 44px; border: 1px solid #666873; border-radius: 7px; padding: 8px 18px; background: #292a2e; color: inherit; font: inherit; cursor: pointer; }
  .error { border: 1px solid #8d6542; border-radius: 9px; padding: 18px; }
  @media (max-width: 480px) { main { padding: 26px 16px 56px; } header { padding: 10px 16px; } h1 { font-size: 26px; } dl div { grid-template-columns: 1fr; gap: 0; margin: 12px 0; } pre { padding: 12px; } }
</style>
