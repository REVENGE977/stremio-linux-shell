import { postEnhancedMessage } from '../utils/dom';

const pendingHttpRequests = new Map<string, (res: { status: number; bodyText: string }) => void>();

export function setupFetchInterceptor(): void {
    (window as any).__receiveHttpResponse = function (id: string, status: number, bodyText: string) {
        const resolver = pendingHttpRequests.get(id);
        if (resolver) {
            pendingHttpRequests.delete(id);
            resolver({ status, bodyText });
        }
    };

    function rustFetch(url: string): Promise<{ status: number; bodyText: string }> {
        return new Promise((resolve) => {
            const reqId = 'req_' + Math.random().toString(36).substring(2, 9);
            const timer = setTimeout(() => {
                if (pendingHttpRequests.has(reqId)) {
                    pendingHttpRequests.delete(reqId);
                    resolve({ status: 504, bodyText: 'Gateway Timeout' });
                }
            }, 30000);

            pendingHttpRequests.set(reqId, ({ status, bodyText }) => {
                clearTimeout(timer);
                resolve({ status, bodyText });
            });

            postEnhancedMessage('httpGet', { id: reqId, url });
        });
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        let cleanInit = init;
        if (init && init.headers) {
            let headers = init.headers;
            if (headers instanceof Headers) {
                headers = new Headers(headers);
                headers.delete('User-Agent');
                headers.delete('user-agent');
                cleanInit = { ...init, headers };
            } else if (Array.isArray(headers)) {
                cleanInit = {
                    ...init,
                    headers: headers.filter(([k]) => k.toLowerCase() !== 'user-agent')
                };
            } else if (typeof headers === 'object') {
                const copy: Record<string, string> = { ...(headers as any) };
                delete copy['User-Agent'];
                delete copy['user-agent'];
                cleanInit = {
                    ...init,
                    headers: copy
                };
            }
        }

        const url = typeof resource === 'string' ? resource : (resource as any)?.url;
        const isGet = !init || !init.method || init.method.toUpperCase() === 'GET';
        const isHttp = url && (url.startsWith('http://') || url.startsWith('https://'));

        try {
            const res = await originalFetch(resource, cleanInit);
            // If the browser fetch returns an unhandled redirect status (3xx) or 403 on an external GET request,
            // fallback to rustFetch so curl can transparently follow redirects and bypass CORS.
            if (isHttp && isGet && ((res.status >= 300 && res.status < 400) || res.status === 403)) {
                console.log(`[Enhanced Fetch] Direct fetch returned status ${res.status} for ${url}, trying Rust proxy fallback...`);
                try {
                    const { status, bodyText } = await rustFetch(url);
                    return new Response(bodyText, {
                        status: status || 200,
                        statusText: status === 200 ? 'OK' : 'Error',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                } catch (proxyErr) {
                    console.error('[Enhanced Fetch] Proxy fallback failed:', proxyErr);
                }
            }
            return res;
        } catch (fetchErr: any) {
            if (isHttp && isGet) {
                console.log(`[Enhanced Fetch] Direct fetch failed for ${url}, trying Rust proxy fallback... (${fetchErr?.message || fetchErr})`);
                try {
                    const { status, bodyText } = await rustFetch(url);
                    return new Response(bodyText, {
                        status: status || 200,
                        statusText: status === 200 ? 'OK' : 'Error',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                } catch (proxyErr) {
                    console.error('[Enhanced Fetch] Proxy fallback failed:', proxyErr);
                }
            }
            throw fetchErr;
        }
    };
}
