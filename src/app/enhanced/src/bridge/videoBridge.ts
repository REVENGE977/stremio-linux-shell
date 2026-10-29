import { PermanentCore } from '../core/permanentCore';
import { enforceTransparency } from './transparencyBridge';

let bridgeHost: HTMLDivElement | null = null;
let bridgeVideo: HTMLVideoElement | null = null;

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
    const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
    if (dur > 0 && bridgeVideo) {
        bridgeVideo.dispatchEvent(new Event('loadedmetadata'));
        bridgeVideo.dispatchEvent(new Event('durationchange'));
    }
}

export function setupVideoBridge(): HTMLVideoElement {
    (window as any).__STREMIO_SHELL__ = true;

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

    bridgeVideo.closest = function (selector: string) {
        if (typeof selector === 'string' && selector.includes('player-container')) {
            return document.querySelector('[class*="player-container"]') ||
                   document.querySelector('.player-container') ||
                   document.body;
        }
        return Element.prototype.closest.call(this, selector);
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
                return (dur > 0 || s !== '') ? 4 : 0;
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
        const dur = (durationVal > 0) ? durationVal : ((PermanentCore.getState?.('player')?.duration / 1000) || 0);
        const cur = (currentTimeVal > 0) ? currentTimeVal : ((PermanentCore.getState?.('player')?.time / 1000) || 0);
        if (!pausedVal && (dur > 0 || cur > 0) && bridgeVideo) {
            bridgeVideo.dispatchEvent(new Event('timeupdate'));
        }
    }, 250);

    return bridgeVideo;
}
