import { PlayerEventMap, PlayerEventName, PlayerStateSnapshot } from '../types';
import { addRawMpvListener, ensureObservedProp } from './mpvApi';

type PlayerListener<K extends PlayerEventName = PlayerEventName> = (payload: PlayerEventMap[K]) => void;

const listeners = new Map<PlayerEventName, Set<PlayerListener<any>>>();

let initialized = false;
let paused = false;
let hasPauseState = false;
let time = 0;
let duration = 0;
let seeking = false;
let wasSeeking = false;
let ended = false;
let path = '';
let tracks: any[] = [];
let sid: string | number | boolean | null = null;
let aid: string | number | boolean | null = null;
let vid: string | number | boolean | null = null;
let secondarySid: string | number | boolean | null = null;

function emit<K extends PlayerEventName>(event: K, payload: PlayerEventMap[K]): void {
    const set = listeners.get(event);
    if (!set || set.size === 0) return;
    for (const cb of Array.from(set)) {
        try {
            cb(payload);
        } catch (err) {
            console.error(`[Enhanced] Error in player.on('${event}') listener:`, err);
        }
    }
}

function ensurePropsForEvent(event: PlayerEventName): void {
    switch (event) {
        case 'play':
        case 'pause':
            ensureObservedProp('pause');
            break;
        case 'seeked':
            ensureObservedProp('seeking');
            ensureObservedProp('time-pos');
            break;
        case 'timeupdate':
            ensureObservedProp('time-pos');
            ensureObservedProp('duration');
            break;
        case 'trackchange':
            ensureObservedProp('track-list');
            ensureObservedProp('sid');
            ensureObservedProp('aid');
            ensureObservedProp('vid');
            ensureObservedProp('secondary-sid');
            break;
        case 'ended':
            break;
    }
}

function parseTrackList(data: any): any[] | null {
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }
    return null;
}

export function setupPlayerBus(): void {
    if (initialized) return;
    initialized = true;

    addRawMpvListener((action, payload) => {
        if (action === 'mpv-prop-change' && payload) {
            const { name, data } = payload;
            if (name === 'path') {
                if (data) {
                    path = String(data);
                    ended = false;
                    wasSeeking = false;
                    hasPauseState = false;
                }
            } else if (name === 'duration') {
                const newDuration = Number(data);
                if (Number.isFinite(newDuration) && newDuration > 0) {
                    duration = newDuration;
                }
            } else if (name === 'time-pos') {
                const newTime = Number(data);
                if (Number.isFinite(newTime) && Math.abs(newTime - time) > 0.01) {
                    time = newTime;
                    emit('timeupdate', { time, duration });
                }
            } else if (name === 'pause') {
                const newPaused = Boolean(data);
                if (!hasPauseState || paused !== newPaused) {
                    paused = newPaused;
                    hasPauseState = true;
                    if (newPaused) {
                        emit('pause', { time, duration, paused: true });
                    } else {
                        emit('play', { time, duration, paused: false });
                    }
                }
            } else if (name === 'seeking') {
                const newSeeking = Boolean(data);
                if (newSeeking) {
                    wasSeeking = true;
                } else if (wasSeeking) {
                    wasSeeking = false;
                    emit('seeked', { time, duration });
                }
                seeking = newSeeking;
            } else if (name === 'track-list') {
                const parsed = parseTrackList(data);
                if (parsed) {
                    tracks = parsed;
                    emit('trackchange', {
                        property: 'track-list',
                        value: tracks,
                        tracks: [...tracks],
                        sid,
                        aid,
                        vid,
                        secondarySid
                    });
                }
            } else if (name === 'sid' || name === 'aid' || name === 'vid' || name === 'secondary-sid') {
                const next = data ?? null;
                const prev = name === 'sid'
                    ? sid
                    : name === 'aid'
                        ? aid
                        : name === 'vid'
                            ? vid
                            : secondarySid;
                if (prev !== next) {
                    if (name === 'sid') sid = next;
                    else if (name === 'aid') aid = next;
                    else if (name === 'vid') vid = next;
                    else secondarySid = next;

                    emit('trackchange', {
                        property: name,
                        value: next,
                        tracks: [...tracks],
                        sid,
                        aid,
                        vid,
                        secondarySid
                    });
                }
            }
        } else if (action === 'mpv-event-ended') {
            ended = true;
            wasSeeking = false;
            hasPauseState = false;
            seeking = false;
            emit('ended', {
                reason: String(payload?.reason || 'unknown'),
                error: payload?.error ?? null
            });
        }
    });
}

export const playerBus = {
    on<K extends PlayerEventName>(event: K, cb: PlayerListener<K>): () => void {
        if (typeof event !== 'string' || typeof cb !== 'function') {
            return () => {};
        }
        let set = listeners.get(event);
        if (!set) {
            set = new Set<PlayerListener<any>>();
            listeners.set(event, set);
        }
        set.add(cb);
        ensurePropsForEvent(event);

        return () => {
            playerBus.off(event, cb);
        };
    },
    once<K extends PlayerEventName>(event: K, cb: PlayerListener<K>): () => void {
        if (typeof event !== 'string' || typeof cb !== 'function') {
            return () => {};
        }
        let unsub: () => void = () => {};
        const wrapper: PlayerListener<K> = (payload) => {
            unsub();
            cb(payload);
        };
        unsub = playerBus.on(event, wrapper);
        return unsub;
    },
    off<K extends PlayerEventName>(event: K, cb: PlayerListener<K>): void {
        const set = listeners.get(event);
        if (!set) return;
        set.delete(cb);
        if (set.size === 0) {
            listeners.delete(event);
        }
    },
    getState(): PlayerStateSnapshot {
        return {
            paused,
            time,
            duration,
            seeking,
            ended,
            path,
            tracks: [...tracks],
            sid,
            aid,
            vid,
            secondarySid
        };
    }
};
