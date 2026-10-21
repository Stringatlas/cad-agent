/** Retry only known busy snapshot reads; never replay an authority mutation. */
export async function torontoReadonlyFetch(url: string, init: RequestInit): Promise<Response> {
  const readonly = init.method === 'GET' && init.body === undefined && [
    '/datasets/toronto3d/cad', '/datasets/toronto3d/overrides', '/datasets/toronto3d/overrides/pending',
  ].includes(url);
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await fetch(url, init);
    if (!readonly || response.status !== 429 || attempt >= 8 || !response.headers.get('content-type')?.startsWith('application/json')) return response;
    // Preserve the original response and each transport's existing validation/errors.
    const reply = await response.clone().json().catch(() => undefined);
    if (reply?.ok !== false || reply?.error?.code !== 'busy') return response;
    await new Promise<void>((resolve, reject) => {
      const clean = () => init.signal?.removeEventListener('abort', abort);
      const abort = () => { clearTimeout(timer); clean(); reject(init.signal?.reason); };
      const timer = setTimeout(() => { clean(); resolve(); }, 100);
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) abort();
    });
  }
}
