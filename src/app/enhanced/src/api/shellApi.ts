import { PlaybackStats, ThumbnailPayload } from '../types';
import { applyShaderPreset } from '../player/shaderControls';
import { setPictureInPicture } from '../bridge/videoBridge';
import { requestPlaybackStats } from '../player/statsOverlay';
import { requestThumbnail } from '../player/thumbnailPreview';

export const shellApi = {
    setShaderPreset(id: string): Promise<boolean> {
        return applyShaderPreset(id);
    },
    setPictureInPicture(enabled: boolean): void {
        setPictureInPicture(enabled);
    },
    getPlaybackStats(): Promise<PlaybackStats | null> {
        return requestPlaybackStats();
    },
    requestThumbnail(time: number, maxWidth?: number): Promise<ThumbnailPayload | null> {
        return requestThumbnail(time, maxWidth);
    }
};
