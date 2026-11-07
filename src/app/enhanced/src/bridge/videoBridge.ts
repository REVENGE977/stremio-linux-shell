import { PermanentCore } from '../core/permanentCore';
import { enforceTransparency } from './transparencyBridge';
import { postEnhancedMessage } from '../utils/dom';

let bridgeHost: HTMLDivElement | null = null;
let bridgeVideo: HTMLVideoElement | null = null;
let pipActive = false;
let pipListenersInitialized = false;

let currentTimeVal = 0;
let durationVal = 0;
let pausedVal = false;
let seekingVal = false;
let endedVal = false;
let speedVal = 1;
let volumeVal = 1;
let mutedVal = false;
let srcVal = '';
let videoWidthVal = 1920;
let videoHeightVal = 1080;

function setPipState(enabled: boolean, notifyRust = true): void {
    const next = Boolean(enabled);
    if (pipActive === next && !notifyRust) return;
    pipActive = next;

    if (pipActive) {
        document.documentElement.classList.add('stremio-pip-mode');
    } else {
        document.documentElement.classList.remove('stremio-pip-mode');
        document.documentElement.style.cursor = '';
        delete document.documentElement.dataset.pipCursor;
    }

    if (notifyRust) {
        postEnhancedMessage('setPictureInPicture', { enabled: pipActive });
    }

    if (bridgeVideo) {
        bridgeVideo.dispatchEvent(new Event(pipActive ? 'enterpictureinpicture' : 'leavepictureinpicture', { bubbles: true }));
    }
}

function setupPipWindowInteractions(): void {
    if (pipListenersInitialized) return;
    pipListenersInitialized = true;

    (window as any).__syncPipState = function (enabled: boolean) {
        setPipState(Boolean(enabled), false);
    };

    const RESIZE_BORDER = 8;
    let dragCandidate = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let suppressNextClick = false;

    function getResizeDirection(e: MouseEvent): number {
        const x = e.clientX;
        const y = e.clientY;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const left = x < RESIZE_BORDER;
        const right = x >= w - RESIZE_BORDER;
        const top = y < RESIZE_BORDER;
        const bottom = y >= h - RESIZE_BORDER;

        if (top && left) return 13;     // HTTOPLEFT
        if (top && right) return 14;    // HTTOPRIGHT
        if (bottom && left) return 16;  // HTBOTTOMLEFT
        if (bottom && right) return 17; // HTBOTTOMRIGHT
        if (left) return 10;            // HTLEFT
        if (right) return 11;           // HTRIGHT
        if (top) return 12;             // HTTOP
        if (bottom) return 15;          // HTBOTTOM
        return 0;
    }

    function cursorForDirection(dir: number): string {
        switch (dir) {
            case 13:
            case 17:
                return 'nwse-resize';
            case 14:
            case 16:
                return 'nesw-resize';
            case 10:
            case 11:
                return 'ew-resize';
            case 12:
            case 15:
                return 'ns-resize';
            default:
                return '';
        }
    }

    const INTERACTIVE_SELECTOR = 'input, select, textarea, button, a, .pip-plugin-button, [class*="slider"], [class*="seek"], [class*="thumb"], [class*="track"], [class*="button-container"], [class*="control-bar-button"], [class*="menu-container"], [class*="popup"]';

    window.addEventListener('pointerdown', (e: PointerEvent) => {
        if (!pipActive || e.button !== 0) return;

        const resizeDir = getResizeDirection(e);
        if (resizeDir !== 0) {
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }

        const target = e.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) {
            return;
        }

        // Prevent hold-to-2x-speed and other pointerdown handlers on the video surface while in PiP
        e.stopPropagation();
        e.stopImmediatePropagation();
    }, true);

    window.addEventListener('mousedown', (e: MouseEvent) => {
        if (!pipActive || e.button !== 0) return;

        const resizeDir = getResizeDirection(e);
        if (resizeDir !== 0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            dragCandidate = false;
            postEnhancedMessage('startPipResize', { direction: resizeDir });
            return;
        }

        const target = e.target as HTMLElement | null;
        if (target?.closest(INTERACTIVE_SELECTOR)) {
            dragCandidate = false;
            return;
        }

        // Prevent hold-to-2x-speed and other mousedown handlers on the video surface while in PiP
        e.stopPropagation();
        e.stopImmediatePropagation();

        dragCandidate = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        suppressNextClick = false;
    }, true);

    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!pipActive) return;

        if (e.buttons === 0) {
            dragCandidate = false;
            const dir = getResizeDirection(e);
            const cursor = cursorForDirection(dir);
            document.documentElement.style.cursor = cursor;
            if (cursor) {
                document.documentElement.dataset.pipCursor = cursor;
            } else {
                delete document.documentElement.dataset.pipCursor;
            }
            return;
        }

        if ((e.buttons & 1) === 1 && dragCandidate) {
            const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
            if (dist > 4) {
                dragCandidate = false;
                suppressNextClick = true;
                postEnhancedMessage('startPipDrag');
            }
        }
    }, true);

    window.addEventListener('mouseup', () => {
        dragCandidate = false;
    }, true);

    window.addEventListener('click', (e: MouseEvent) => {
        if (suppressNextClick) {
            suppressNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }, true);
}

function createTimeRanges(start: number, end: number) {
    return {
        length: end > start ? 1 : 0,
        start(i: number) {
            if (i === 0 && end > start) return start;
            throw new DOMException('IndexSizeError');
        },
        end(i: number) {
            if (i === 0 && end > start) return end;
            throw new DOMException('IndexSizeError');
        }
    };
}

export function mountBridgeHost(): void {
    if (!bridgeHost) return;
    const playerContainer = document.querySelector<HTMLElement>('[class*="player-container"]');
    const targetParent = playerContainer || document.body;
    if (targetParent && bridgeHost.parentElement !== targetParent) {
        targetParent.appendChild(bridgeHost);
        console.log(`[Enhanced] Mounted bridge video host to ${playerContainer ? 'player-container' : 'document.body'}`);
    }
}

export function ensureBridgeVideo(): void {
    mountBridgeHost();
    enforceTransparency();
    if (pipActive) {
        const inPlayer = window.location.hash.startsWith('#/player') || Boolean(document.querySelector('[class*="player-container"]'));
        if (!inPlayer) {
            setPipState(false, true);
        }
    }
    const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
    if (dur > 0 && bridgeVideo) {
        bridgeVideo.dispatchEvent(new Event('loadedmetadata'));
        bridgeVideo.dispatchEvent(new Event('durationchange'));
    }
}

export function setupVideoBridge(): HTMLVideoElement {
    (window as any).__STREMIO_SHELL__ = true;
    setupPipWindowInteractions();

    bridgeHost = document.getElementById('stremio-enhanced-bridge-host') as HTMLDivElement;
    if (!bridgeHost) {
        bridgeHost = document.createElement('div');
        bridgeHost.id = 'stremio-enhanced-bridge-host';
        Object.assign(bridgeHost.style, {
            position: 'fixed',
            top: '0px',
            left: '0px',
            width: '0px',
            height: '0px',
            opacity: '0',
            pointerEvents: 'none',
            zIndex: '-9999',
            overflow: 'hidden'
        });
    }

    bridgeVideo = document.getElementById('stremio-shell-bridge-video') as HTMLVideoElement;
    if (!bridgeVideo) {
        bridgeVideo = document.createElement('video');
        bridgeVideo.id = 'stremio-shell-bridge-video';
        bridgeVideo.className = 'stremio-shell-bridge-video';
        bridgeVideo.setAttribute('playsinline', '');
        bridgeVideo.setAttribute('muted', '');
        bridgeHost.appendChild(bridgeVideo);
    }

    // Bridge DOM query methods so plugins always discover bridgeVideo
    try {
        const origDocQS = Document.prototype.querySelector;
        const origDocQSA = Document.prototype.querySelectorAll;
        const origElemQS = Element.prototype.querySelector;

        Document.prototype.querySelector = function <E extends Element = Element>(selectors: string): E | null {
            const result = origDocQS.call(this, selectors);
            if (!result && bridgeVideo && typeof selectors === 'string') {
                if (selectors === 'video' || selectors.endsWith(' video') || (selectors.includes('player-container') && selectors.includes('video'))) {
                    if (document.querySelector('[class*="player-container"]') || window.location.hash.includes('player')) {
                        return bridgeVideo as unknown as E;
                    }
                }
            }
            return result;
        };

        Document.prototype.querySelectorAll = function <E extends Element = Element>(selectors: string): NodeListOf<E> {
            if (typeof selectors === 'string' && selectors.includes('video')) {
                mountBridgeHost();
            }
            return origDocQSA.call(this, selectors);
        };

        Element.prototype.querySelector = function <E extends Element = Element>(selectors: string): E | null {
            const result = origElemQS.call(this, selectors);
            if (!result && bridgeVideo && typeof selectors === 'string') {
                if (selectors === 'video' || selectors.endsWith(' video')) {
                    if (this.matches?.('[class*="player-container"]') || this.closest?.('[class*="player-container"]')) {
                        return bridgeVideo as unknown as E;
                    }
                }
            }
            return result;
        };
    } catch (e) {
        console.warn('[Enhanced] Could not patch querySelector:', e);
    }

    // Bridge Picture-in-Picture API on Document
    try {
        const origPipElemDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'pictureInPictureElement') ||
                                Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'pictureInPictureElement');
        Object.defineProperty(Document.prototype, 'pictureInPictureElement', {
            get() {
                if (pipActive && bridgeVideo) return bridgeVideo;
                return origPipElemDesc?.get ? origPipElemDesc.get.call(this) : null;
            },
            configurable: true
        });

        Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', {
            get() { return true; },
            configurable: true
        });

        const origExitPip = Document.prototype.exitPictureInPicture;
        Document.prototype.exitPictureInPicture = function (): Promise<void> {
            if (pipActive) {
                setPipState(false, true);
                return Promise.resolve();
            }
            if (typeof origExitPip === 'function') {
                return origExitPip.call(this);
            }
            return Promise.resolve();
        };
    } catch (e) {
        console.warn('[Enhanced] Could not patch Document PiP API:', e);
    }

    bridgeVideo.closest = function (selector: string) {
        if (typeof selector === 'string' && selector.includes('player-container')) {
            return document.querySelector('[class*="player-container"]') ||
                   document.querySelector('.player-container') ||
                   document.body;
        }
        return Element.prototype.closest.call(this, selector);
    };

    bridgeVideo.getBoundingClientRect = function (): DOMRect {
        const playerContainer = document.querySelector<HTMLElement>('[class*="player-container"]');
        if (playerContainer) {
            return playerContainer.getBoundingClientRect();
        }
        const w = window.innerWidth || 1280;
        const h = window.innerHeight || 720;
        return new DOMRect(0, 0, w, h);
    };

    (bridgeVideo as any).requestPictureInPicture = function (): Promise<any> {
        setPipState(true, true);
        return Promise.resolve({
            width: window.innerWidth || 480,
            height: window.innerHeight || 270,
            onresize: null,
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return true; }
        });
    };

    Object.defineProperty(bridgeVideo, 'webkitPresentationMode', {
        get() {
            return pipActive ? 'picture-in-picture' : 'inline';
        },
        configurable: true
    });

    (bridgeVideo as any).webkitSupportsPresentationMode = function (mode: string): boolean {
        return mode === 'picture-in-picture' || mode === 'inline';
    };

    (bridgeVideo as any).webkitSetPresentationMode = function (mode: string): void {
        setPipState(mode === 'picture-in-picture', true);
    };

    try {
        Object.defineProperty(bridgeVideo, 'currentTime', {
            get() {
                if (currentTimeVal > 0) return currentTimeVal;
                const coreTime = PermanentCore.getState?.('player')?.time;
                if (coreTime && coreTime > 0) return coreTime / 1000;
                return 0;
            },
            set(val: number) {
                const targetTime = Math.max(0, Number(val) || 0);
                currentTimeVal = targetTime;
                console.log(`[Enhanced BridgeVideo] Seeking to ${targetTime}s`);

                try {
                    const postIpc = (data: any) => {
                        const json = typeof data === 'string' ? data : JSON.stringify(data);
                        if ((window as any).ipc?.postMessage) {
                            (window as any).ipc.postMessage(json);
                        } else if ((window as any).chrome?.webview?.postMessage) {
                            (window as any).chrome.webview.postMessage(json);
                        }
                    };

                    // 1. mpv-command seek
                    postIpc({
                        id: 1,
                        type: 6,
                        args: ["mpv-command", ["seek", String(targetTime), "absolute"]]
                    });

                    // 2. mpv-set-prop time-pos
                    postIpc({
                        id: 1,
                        type: 6,
                        args: ["mpv-set-prop", ["time-pos", targetTime]]
                    });

                    // 3. Stremio Core Player Seek
                    const coreDispatch = (window as any).core?.dispatch || (window as any).PermanentCore?.dispatch;
                    if (typeof coreDispatch === 'function') {
                        coreDispatch({
                            action: 'Player',
                            args: { action: 'Seek', time: Math.round(targetTime * 1000) }
                        });
                    }
                } catch (e) {
                    console.error('[Enhanced BridgeVideo] Failed to post seek IPC:', e);
                }

                bridgeVideo!.dispatchEvent(new Event('seeking'));
                bridgeVideo!.dispatchEvent(new Event('timeupdate'));
                setTimeout(() => {
                    bridgeVideo?.dispatchEvent(new Event('seeked'));
                    bridgeVideo?.dispatchEvent(new Event('timeupdate'));
                }, 50);
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'duration', {
            get() {
                if (durationVal > 0) return durationVal;
                const coreDur = PermanentCore.getState?.('player')?.duration;
                if (coreDur && coreDur > 0) return coreDur / 1000;
                return 0;
            },
            set(val: number) {
                const newDuration = Math.max(0, Number(val) || 0);
                if (durationVal !== newDuration) {
                    durationVal = newDuration;
                    bridgeVideo!.dispatchEvent(new Event('durationchange'));
                    bridgeVideo!.dispatchEvent(new Event('loadedmetadata'));
                }
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'paused', {
            get() {
                return pausedVal;
            },
            set(val: boolean) {
                pausedVal = Boolean(val);
                try {
                    if ((window as any).ipc?.postMessage) {
                        (window as any).ipc.postMessage(JSON.stringify({
                            type: 6,
                            args: ["mpv-set-prop", ["pause", pausedVal]]
                        }));
                    }
                } catch (_) {}
                bridgeVideo!.dispatchEvent(new Event(pausedVal ? 'pause' : 'play'));
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'seeking', {
            get() { return seekingVal; },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'ended', {
            get() { return endedVal; },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'playbackRate', {
            get() { return speedVal; },
            set(val: number) {
                speedVal = Number(val) || 1;
                try {
                    if ((window as any).ipc?.postMessage) {
                        (window as any).ipc.postMessage(JSON.stringify({
                            type: 6,
                            args: ["mpv-set-prop", ["speed", speedVal]]
                        }));
                    }
                } catch (_) {}
                bridgeVideo!.dispatchEvent(new Event('ratechange'));
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'volume', {
            get() { return volumeVal; },
            set(val: number) {
                volumeVal = Number(val) || 1;
                try {
                    if ((window as any).ipc?.postMessage) {
                        (window as any).ipc.postMessage(JSON.stringify({
                            type: 6,
                            args: ["mpv-set-prop", ["volume", volumeVal * 100]]
                        }));
                    }
                } catch (_) {}
                bridgeVideo!.dispatchEvent(new Event('volumechange'));
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'muted', {
            get() { return mutedVal; },
            set(val: boolean) {
                mutedVal = Boolean(val);
                try {
                    if ((window as any).ipc?.postMessage) {
                        (window as any).ipc.postMessage(JSON.stringify({
                            type: 6,
                            args: ["mpv-set-prop", ["mute", mutedVal]]
                        }));
                    }
                } catch (_) {}
                bridgeVideo!.dispatchEvent(new Event('volumechange'));
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'src', {
            get() {
                const s = srcVal || PermanentCore.getState?.('player')?.selected?.stream?.url || '';
                if (s && bridgeVideo!.getAttribute('src') !== s) {
                    bridgeVideo!.setAttribute('src', s);
                }
                return s;
            },
            set(val: string) {
                srcVal = String(val || '');
                bridgeVideo!.setAttribute('src', srcVal);
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'currentSrc', {
            get() {
                const s = srcVal || PermanentCore.getState?.('player')?.selected?.stream?.url || '';
                if (s && bridgeVideo!.getAttribute('src') !== s) {
                    bridgeVideo!.setAttribute('src', s);
                }
                return s;
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'readyState', {
            get() {
                const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
                const s = srcVal || PermanentCore.getState?.('player')?.selected?.stream?.url || '';
                const inPlayer = window.location.hash.startsWith('#/player') || Boolean(document.querySelector('[class*="player-container"]'));
                return (dur > 0 || s !== '' || inPlayer) ? 4 : 0;
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'videoWidth', {
            get() { return videoWidthVal; },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'videoHeight', {
            get() { return videoHeightVal; },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'buffered', {
            get() {
                const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
                return createTimeRanges(0, dur);
            },
            configurable: true
        });

        Object.defineProperty(bridgeVideo, 'seekable', {
            get() {
                const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
                return createTimeRanges(0, dur);
            },
            configurable: true
        });

        bridgeVideo.play = function () {
            pausedVal = false;
            try {
                if ((window as any).ipc?.postMessage) {
                    (window as any).ipc.postMessage(JSON.stringify({ type: 6, args: ["mpv-set-prop", ["pause", false]] }));
                }
            } catch (_) {}
            bridgeVideo!.dispatchEvent(new Event('play'));
            return Promise.resolve();
        };

        bridgeVideo.pause = function () {
            pausedVal = true;
            try {
                if ((window as any).ipc?.postMessage) {
                    (window as any).ipc.postMessage(JSON.stringify({ type: 6, args: ["mpv-set-prop", ["pause", true]] }));
                }
            } catch (_) {}
            bridgeVideo!.dispatchEvent(new Event('pause'));
        };
    } catch (e) {
        console.warn('[Enhanced] Failed to define bridgeVideo properties:', e);
    }

    // Listen to MPV Property Changes via window.ipc
    if ((window as any).ipc?.addEventListener) {
        (window as any).ipc.addEventListener('message', (event: any) => {
            try {
                let msg = event.data;
                if (typeof msg === 'string') {
                    msg = JSON.parse(msg);
                }
                if (!msg || !msg.args || !Array.isArray(msg.args)) return;

                const [action, payload] = msg.args;
                if (action === 'mpv-prop-change' && payload) {
                    const { name, data } = payload;
                    if (name === 'time-pos') {
                        const newTime = Number(data);
                        if (Number.isFinite(newTime) && Math.abs(currentTimeVal - newTime) > 0.01) {
                            currentTimeVal = newTime;
                            bridgeVideo!.dispatchEvent(new Event('timeupdate'));
                        }
                    } else if (name === 'duration') {
                        const newDuration = Number(data);
                        if (Number.isFinite(newDuration) && newDuration > 0 && durationVal !== newDuration) {
                            durationVal = newDuration;
                            bridgeVideo!.dispatchEvent(new Event('durationchange'));
                            bridgeVideo!.dispatchEvent(new Event('loadedmetadata'));
                        }
                    } else if (name === 'pause') {
                        const newPaused = Boolean(data);
                        if (pausedVal !== newPaused) {
                            pausedVal = newPaused;
                            bridgeVideo!.dispatchEvent(new Event(pausedVal ? 'pause' : 'play'));
                        }
                    } else if (name === 'seeking') {
                        seekingVal = Boolean(data);
                        if (seekingVal) {
                            bridgeVideo!.dispatchEvent(new Event('seeking'));
                        } else {
                            bridgeVideo!.dispatchEvent(new Event('seeked'));
                            bridgeVideo!.dispatchEvent(new Event('timeupdate'));
                        }
                    } else if (name === 'path') {
                        if (data) {
                            srcVal = String(data);
                            endedVal = false;
                            bridgeVideo!.setAttribute('src', srcVal);
                            bridgeVideo!.dispatchEvent(new Event('loadstart'));
                            bridgeVideo!.dispatchEvent(new Event('loadedmetadata'));
                        }
                    } else if (name === 'speed') {
                        speedVal = Number(data) || 1;
                        bridgeVideo!.dispatchEvent(new Event('ratechange'));
                    } else if (name === 'volume') {
                        volumeVal = (Number(data) || 100) / 100;
                        bridgeVideo!.dispatchEvent(new Event('volumechange'));
                    } else if (name === 'mute') {
                        mutedVal = Boolean(data);
                        bridgeVideo!.dispatchEvent(new Event('volumechange'));
                    } else if (name === 'video-params') {
                        try {
                            const params = typeof data === 'string' ? JSON.parse(data) : data;
                            if (params && params.w && params.h) {
                                videoWidthVal = Number(params.w) || 1920;
                                videoHeightVal = Number(params.h) || 1080;
                            }
                        } catch (_) {}
                    }
                } else if (action === 'mpv-event-ended') {
                    endedVal = true;
                    bridgeVideo!.dispatchEvent(new Event('ended'));
                }
            } catch (_) {}
        });
    }

    if (document.body) {
        mountBridgeHost();
    } else {
        document.addEventListener('DOMContentLoaded', mountBridgeHost, { once: true });
        window.addEventListener('load', mountBridgeHost, { once: true });
    }

    // Periodic timeupdate and host mount verification when playing
    setInterval(() => {
        mountBridgeHost();
        if (pipActive) {
            const inPlayer = window.location.hash.startsWith('#/player') || Boolean(document.querySelector('[class*="player-container"]'));
            if (!inPlayer) {
                setPipState(false, true);
            }
        }
        const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
        const cur = (currentTimeVal > 0) ? currentTimeVal : ((PermanentCore.getState?.('player')?.time / 1000) || 0);
        if (!pausedVal && (dur > 0 || cur > 0) && bridgeVideo) {
            bridgeVideo.dispatchEvent(new Event('timeupdate'));
        }
    }, 250);

    return bridgeVideo;
}
