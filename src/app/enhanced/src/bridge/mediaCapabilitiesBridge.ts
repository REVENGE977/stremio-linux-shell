/**
 * Bridges standard Web Media APIs (MediaSource, HTMLMediaElement, MediaCapabilities)
 * to reflect the native decoding capabilities of the underlying MPV engine (HEVC, AV1, VP9, etc.).
 * This allows plugins and web players to know the environment supports modern video codecs natively.
 */
export function setupMediaCapabilitiesBridge(): void {
    const isAdvancedCodec = (codecStr: string): boolean => {
        if (!codecStr) return false;
        return /hvc1|hev1|hevc|av01|vp09|vp9|avc1/i.test(codecStr);
    };

    // 1. MediaSource.isTypeSupported
    if (typeof window !== 'undefined' && window.MediaSource) {
        const origIsTypeSupported = window.MediaSource.isTypeSupported.bind(window.MediaSource);
        window.MediaSource.isTypeSupported = function (type: string): boolean {
            if (isAdvancedCodec(type)) return true;
            return origIsTypeSupported(type);
        };
    }

    // 2. HTMLMediaElement.prototype.canPlayType
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.canPlayType) {
        const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (type: string): CanPlayTypeResult {
            if (isAdvancedCodec(type)) return 'probably';
            return origCanPlayType.call(this, type);
        };
    }

    // 3. navigator.mediaCapabilities.decodingInfo
    if (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.decodingInfo) {
        const origDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
        navigator.mediaCapabilities.decodingInfo = async function (configuration: MediaDecodingConfiguration): Promise<MediaCapabilitiesDecodingInfo> {
            const videoType = configuration?.video?.contentType || '';
            if (isAdvancedCodec(videoType)) {
                return {
                    supported: true,
                    smooth: true,
                    powerEfficient: true,
                    keySystemAccess: null
                };
            }
            return origDecodingInfo(configuration);
        };
    }
}

