export interface PermanentCoreType {
    getState: ((model: string) => any) | null;
    dispatch: ((action: any) => void) | null;
}

export const PermanentCore: PermanentCoreType = {
    getState: null,
    dispatch: null,
};

let originalServices = (window as any).services;
let originalCore = (window as any).core;

export function isOurWrapper(fn: any): boolean {
    return !!(fn && fn.__isEnhancedWrapper === true);
}

export function captureCore(coreObj: any): void {
    if (!coreObj) return;
    if (coreObj.transport && typeof coreObj.transport.getState === 'function' && !isOurWrapper(coreObj.transport.getState)) {
        PermanentCore.getState = coreObj.transport.getState.bind(coreObj.transport);
    } else if (typeof coreObj.getState === 'function' && !isOurWrapper(coreObj.getState)) {
        PermanentCore.getState = coreObj.getState.bind(coreObj);
    }
    if (coreObj.transport && typeof coreObj.transport.dispatch === 'function' && !isOurWrapper(coreObj.transport.dispatch)) {
        PermanentCore.dispatch = coreObj.transport.dispatch.bind(coreObj.transport);
    } else if (typeof coreObj.dispatch === 'function' && !isOurWrapper(coreObj.dispatch)) {
        PermanentCore.dispatch = coreObj.dispatch.bind(coreObj);
    }
}

export function getActiveGetState(): ((model: string) => any) | null {
    if (originalServices && originalServices.core) {
        const t = originalServices.core.transport;
        if (t && typeof t.getState === 'function' && !isOurWrapper(t.getState)) {
            return t.getState.bind(t);
        }
        const g = originalServices.core.getState;
        if (typeof g === 'function' && !isOurWrapper(g)) {
            return g.bind(originalServices.core);
        }
    }
    if (originalCore) {
        const t = originalCore.transport;
        if (t && typeof t.getState === 'function' && !isOurWrapper(t.getState)) {
            return t.getState.bind(t);
        }
        const g = originalCore.getState;
        if (typeof g === 'function' && !isOurWrapper(g)) {
            return g.bind(originalCore);
        }
    }
    return (PermanentCore.getState && !isOurWrapper(PermanentCore.getState)) ? PermanentCore.getState : null;
}

export function getActiveDispatch(): ((action: any) => void) | null {
    if (originalServices && originalServices.core) {
        const t = originalServices.core.transport;
        if (t && typeof t.dispatch === 'function' && !isOurWrapper(t.dispatch)) {
            return t.dispatch.bind(t);
        }
        const d = originalServices.core.dispatch;
        if (typeof d === 'function' && !isOurWrapper(d)) {
            return d.bind(originalServices.core);
        }
    }
    if (originalCore) {
        const t = originalCore.transport;
        if (t && typeof t.dispatch === 'function' && !isOurWrapper(t.dispatch)) {
            return t.dispatch.bind(t);
        }
        const d = originalCore.dispatch;
        if (typeof d === 'function' && !isOurWrapper(d)) {
            return d.bind(originalCore);
        }
    }
    return (PermanentCore.dispatch && !isOurWrapper(PermanentCore.dispatch)) ? PermanentCore.dispatch : null;
}

export function createGetStateWrapper(): (m: string) => any {
    const fn: any = function (m: string) {
        const target = getActiveGetState();
        if (target && !isOurWrapper(target)) {
            return target(m);
        }
        return null;
    };
    fn.__isEnhancedWrapper = true;
    return fn;
}

export function createDispatchWrapper(): (a: any) => void {
    const fn: any = function (a: any) {
        const target = getActiveDispatch();
        if (target && !isOurWrapper(target)) {
            return target(a);
        }
        return null;
    };
    fn.__isEnhancedWrapper = true;
    return fn;
}

export function setupPermanentCore(): void {
    try {
        if (originalServices && originalServices.core) {
            captureCore(originalServices.core);
        }
        if (originalCore) {
            captureCore(originalCore);
        }

        Object.defineProperty(window, 'services', {
            get() {
                if (!originalServices) originalServices = {};
                if (!originalServices.core) originalServices.core = {};
                if (!originalServices.core.transport) originalServices.core.transport = {};

                if (!originalServices.core.getState || isOurWrapper(originalServices.core.getState)) {
                    originalServices.core.getState = createGetStateWrapper();
                }
                if (!originalServices.core.dispatch || isOurWrapper(originalServices.core.dispatch)) {
                    originalServices.core.dispatch = createDispatchWrapper();
                }
                if (!originalServices.core.transport.getState || isOurWrapper(originalServices.core.transport.getState)) {
                    originalServices.core.transport.getState = createGetStateWrapper();
                }
                if (!originalServices.core.transport.dispatch || isOurWrapper(originalServices.core.transport.dispatch)) {
                    originalServices.core.transport.dispatch = createDispatchWrapper();
                }

                return originalServices;
            },
            set(val) {
                originalServices = val;
                if (val && val.core) {
                    captureCore(val.core);
                }
            },
            configurable: true,
            enumerable: true
        });

        Object.defineProperty(window, 'core', {
            get() {
                if (!originalCore) originalCore = {};
                if (!originalCore.transport) originalCore.transport = {};

                if (!originalCore.getState || isOurWrapper(originalCore.getState)) {
                    originalCore.getState = createGetStateWrapper();
                }
                if (!originalCore.dispatch || isOurWrapper(originalCore.dispatch)) {
                    originalCore.dispatch = createDispatchWrapper();
                }
                if (!originalCore.transport.getState || isOurWrapper(originalCore.transport.getState)) {
                    originalCore.transport.getState = createGetStateWrapper();
                }
                if (!originalCore.transport.dispatch || isOurWrapper(originalCore.transport.dispatch)) {
                    originalCore.transport.dispatch = createDispatchWrapper();
                }

                return originalCore;
            },
            set(val) {
                originalCore = val;
                captureCore(val);
            },
            configurable: true,
            enumerable: true
        });

        // Poller to capture core once instantiated by Stremio
        const captureInterval = setInterval(() => {
            if ((window as any).services && (window as any).services.core) {
                captureCore((window as any).services.core);
            }
            if ((window as any).core) {
                captureCore((window as any).core);
            }
            if (PermanentCore.getState && PermanentCore.dispatch) {
                clearInterval(captureInterval);
            }
        }, 500);

        (window as any).PermanentCore = PermanentCore;
    } catch (e) {
        console.warn('[Enhanced] Failed to initialize PermanentCore interceptor:', e);
    }
}
