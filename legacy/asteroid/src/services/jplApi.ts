const JPL_API_BASE = 'https://ssd-api.jpl.nasa.gov';

export async function fetchJplJson<T>(path: string, params: URLSearchParams): Promise<T> {
  const query = params.toString();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const directUrl = `${JPL_API_BASE}${normalizedPath}${query ? `?${query}` : ''}`;
  const proxyUrl = `/api/jpl${normalizedPath}${query ? `?${query}` : ''}`;
  const urls = [directUrl, proxyUrl];
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`NASA API returned ${response.status}`);
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('NASA API request failed');
    }
  }

  throw lastError ?? new Error('NASA API request failed');
}
