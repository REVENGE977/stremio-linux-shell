type MpvPropCallback = (value: any, prop: string) => void;
type RawMpvListener = (action: string, payload: any) => void;

const propListeners = new Map<string, Set<MpvPropCallback>>();
const observedInSession = new Set<string>();
const extraObservedProps = new Set<string>();
const rawListeners = new Set<RawMpvListener>();

let initialized = false;
let needsReobserve = false;

function postMpvIpc(args: any[]): void {
    try {
        const json = JSON.stringify({ type: 6, args });
        if ((window as any).ipc?.postMessage) {
            (window as any).ipc.postMessage(json);
        } else if ((window as any).chrome?.webview?.postMessage) {
            (window as any).chrome.webview.postMessage(json);
        }
    } catch (err) {
        console.warn('[Enhanced] Failed to post mpv IPC message:', err);
    }
}

export function ensureObservedProp(prop: string): void {
    if (typeof prop !== 'string' || !prop) return;
    extraObservedProps.add(prop);
    if (!observedInSession.has(prop)) {
        observedInSession.add(prop);
        postMpvIpc(['mpv-observe-prop', prop]);
    }
}

function reobserveActiveProps(): void {
    const toObserve = new Set<string>([
        ...propListeners.keys(),
        ...extraObservedProps
    ]);
    for (const prop of toObserve) {
        if (!observedInSession.has(prop)) {
            observedInSession.add(prop);
            postMpvIpc(['mpv-observe-prop', prop]);
        }
    }
}

export function addRawMpvListener(fn: RawMpvListener): () => void {
    rawListeners.add(fn);
    return () => {
        rawListeners.delete(fn);
    };
}

export function setupMpvApi(): void {
    if (initialized) return;
    initialized = true;

    const ipc = (window as any).ipc;
    if (!ipc || typeof ipc.addEventListener !== 'function') return;

    ipc.addEventListener('message', (event: any) => {
        try {
            let msg = event?.data;
            if (typeof msg === 'string') {
                msg = JSON.parse(msg);
            }
            if (!msg || !Array.isArray(msg.args)) return;

            const [action, payload] = msg.args;
            if (action === 'mpv-prop-change' && payload && typeof payload.name === 'string') {
                if (needsReobserve) {
                    needsReobserve = false;
                    reobserveActiveProps();
                }

                const listeners = propListeners.get(payload.name);
                if (listeners && listeners.size > 0) {
                    for (const cb of Array.from(listeners)) {
                        try {
                            cb(payload.data, payload.name);
                        } catch (err) {
                            console.error(`[Enhanced] Error in mpv.observe('${payload.name}') callback:`, err);
                        }
                    }
                }

                for (const fn of Array.from(rawListeners)) {
                    try {
                        fn('mpv-prop-change', payload);
                    } catch (err) {
                        console.error('[Enhanced] Error in raw mpv listener:', err);
                    }
                }
            } else if (action === 'mpv-event-ended') {
                observedInSession.clear();
                needsReobserve = true;
                for (const fn of Array.from(rawListeners)) {
                    try {
                        fn('mpv-event-ended', payload || {});
                    } catch (err) {
                        console.error('[Enhanced] Error in raw mpv listener:', err);
                    }
                }
            }
        } catch (_) {}
    });
}

export const mpvApi = {
    set(prop: string, value: any): void {
        if (typeof prop !== 'string' || !prop) return;
        postMpvIpc(['mpv-set-prop', [prop, value]]);
    },
    command(name: string, ...args: any[]): void {
        if (typeof name !== 'string' || !name) return;
        postMpvIpc(['mpv-command', [name, ...args]]);
    },
    observe(prop: string, cb: MpvPropCallback): () => void {
        if (typeof prop !== 'string' || !prop || typeof cb !== 'function') {
            return () => {};
        }
        let set = propListeners.get(prop);
        if (!set) {
            set = new Set<MpvPropCallback>();
            propListeners.set(prop, set);
        }
        set.add(cb);

        if (!observedInSession.has(prop)) {
            observedInSession.add(prop);
            postMpvIpc(['mpv-observe-prop', prop]);
        }

        return () => {
            const current = propListeners.get(prop);
            if (!current) return;
            current.delete(cb);
            if (current.size === 0) {
                propListeners.delete(prop);
            }
        };
    }
};
