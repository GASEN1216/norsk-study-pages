// Share in-flight requests; failed or timed-out requests remain retryable.
export function createDataLoader(data, {version, timeout = 20000, fetcher = globalThis.fetch} = {}) {
  const pending = new Map();
  return function load(name, path = `data/${name}.json`) {
    if (Object.hasOwn(data, name)) return Promise.resolve(data[name]);
    if (pending.has(name)) return pending.get(name);
    const request = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const expired = new Promise((_,reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error(`${name}: request timed out`),{name:'AbortError'}));
          },timeout);
        });
        const operation = (async () => {
          const separator = path.includes('?') ? '&' : '?';
          const response = await fetcher(version ? `${path}${separator}v=${encodeURIComponent(version)}` : path, {signal:controller.signal});
          if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
          const value = await response.json();
          // A late response from an aborted request must not overwrite a successful retry's cache.
          if (controller.signal.aborted) throw Object.assign(new Error(`${name}: expired response`),{name:'AbortError'});
          data[name] = value;
          return value;
        })();
        // Bound both transport and body decoding, even if a fetch adapter ignores AbortSignal.
        return await Promise.race([operation,expired]);
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.set(name, request);
    const cleanup = () => { if (pending.get(name) === request) pending.delete(name); };
    request.then(cleanup, cleanup);
    return request;
  };
}
