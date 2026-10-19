// Share in-flight requests; failed or timed-out requests remain retryable.
export function createDataLoader(data, {version, timeout = 20000, fetcher = globalThis.fetch} = {}) {
  const pending = new Map();
  return function load(name, path = `data/${name}.json`) {
    if (Object.hasOwn(data, name)) return Promise.resolve(data[name]);
    if (pending.has(name)) return pending.get(name);
    const request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const separator = path.includes('?') ? '&' : '?';
        const response = await fetcher(version ? `${path}${separator}v=${encodeURIComponent(version)}` : path, {signal:controller.signal});
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        const value = await response.json();
        data[name] = value;
        return value;
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
