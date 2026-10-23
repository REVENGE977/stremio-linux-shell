import { ServerStatusUiData } from '../types';
import { modalManager } from '../components/modals/modalManager';
import { postEnhancedMessage } from '../utils/dom';
import { isNewerVersion } from '../updates/updateManager';

export const DEFAULT_SERVER_JS_URL = 'https://dl.strem.io/server/v4.21.1/desktop/server.js';
export const CARGO_TOML_URL = 'https://raw.githubusercontent.com/Stremio/stremio-service/refs/heads/master/Cargo.toml';

let currentServerStatus: ServerStatusUiData = {
    exists: false,
    running: false,
    serverDir: '',
    serverPath: '',
    currentVersion: null,
    skippedVersion: null
};

let isCheckingServer = false;
let hasPromptedInitialSetup = false;
export let latestServerJsUrl: string = DEFAULT_SERVER_JS_URL;

const pendingServerStatusRequests = new Map<string, (status: ServerStatusUiData) => void>();
const pendingServerStartRequests = new Map<string, (success: boolean) => void>();

export function setupServerManager(): void {
    (window as any).__receiveServerStatus = function (id: string, status: ServerStatusUiData) {
        if (status) {
            currentServerStatus = status;
        }
        const resolver = pendingServerStatusRequests.get(id);
        if (resolver) {
            pendingServerStatusRequests.delete(id);
            resolver(status);
        }
    };

    (window as any).__receiveServerStartResult = function (id: string, success: boolean) {
        if (currentServerStatus) {
            currentServerStatus.running = !!success;
        }
        const resolver = pendingServerStartRequests.get(id);
        if (resolver) {
            pendingServerStartRequests.delete(id);
            resolver(success);
        }
    };

    if ((window as any).__INITIAL_ENHANCED_DATA__?.serverStatus) {
        currentServerStatus = (window as any).__INITIAL_ENHANCED_DATA__.serverStatus;
    }
}

export function updateServerManagerData(status: ServerStatusUiData): void {
    if (status) {
        currentServerStatus = status;
    }
}

export function getCurrentServerStatus(): ServerStatusUiData {
    return currentServerStatus;
}

export function getServerStatus(): Promise<ServerStatusUiData> {
    return new Promise((resolve) => {
        const id = 'srv_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            if (pendingServerStatusRequests.has(id)) {
                pendingServerStatusRequests.delete(id);
                resolve(currentServerStatus);
            }
        }, 10000);

        pendingServerStatusRequests.set(id, (status) => {
            clearTimeout(timer);
            resolve(status);
        });

        postEnhancedMessage('getServerStatus', { id });
    });
}

let isReloadingToLocal = false;

export function reloadToLocalStreamingServer(): void {
    if (isReloadingToLocal) return;

    if (window.location.hostname === '127.0.0.1') {
        try {
            (window as any).core?.dispatch?.({ action: 'StreamingServer', args: { action: 'Reload' } });
        } catch (_) {}
        return;
    }

    isReloadingToLocal = true;
    const hash = window.location.hash || '#/';
    const targetUrl = `http://127.0.0.1:11470/proxy/d=https%3A%2F%2Fweb.stremio.com/${hash}`;
    console.log('[Enhanced Server] Streaming server running. Reloading from web.stremio.com to local proxy:', targetUrl);

    setTimeout(() => {
        postEnhancedMessage('loadUrl', { url: targetUrl });
        try {
            window.location.replace(targetUrl);
        } catch (_) {
            window.location.href = targetUrl;
        }
    }, 500);
}

export function startStreamingServer(): Promise<boolean> {
    return new Promise((resolve) => {
        const id = 'start_' + Math.random().toString(36).substring(2, 9);
        const timer = setTimeout(() => {
            if (pendingServerStartRequests.has(id)) {
                pendingServerStartRequests.delete(id);
                resolve(false);
            }
        }, 15000);

        pendingServerStartRequests.set(id, (success) => {
            clearTimeout(timer);
            if (success && window.location.hostname !== '127.0.0.1') {
                reloadToLocalStreamingServer();
            }
            resolve(success);
        });

        postEnhancedMessage('startStreamingServer', { id });
    });
}

export function openStreamingServerFolder(): void {
    postEnhancedMessage('openStreamingServerFolder');
}

export async function fetchLatestServerVersion(): Promise<{ version: string; downloadUrl: string } | null> {
    try {
        const res = await window.fetch(CARGO_TOML_URL);
        if (!res.ok) {
            console.warn('[Enhanced Server] Failed to fetch Cargo.toml:', res.status);
            return null;
        }
        const text = await res.text();
        const match = text.match(/\[package\.metadata\.server\][\s\S]*?version\s*=\s*"([^"]+)"/);
        if (!match || !match[1]) {
            console.warn('[Enhanced Server] Could not find server version in Cargo.toml');
            return null;
        }

        let ver = match[1].trim();
        if (!ver.startsWith('v')) {
            ver = 'v' + ver;
        }
        const downloadUrl = `https://dl.strem.io/server/${ver}/desktop/server.js`;
        return { version: ver, downloadUrl };
    } catch (e) {
        console.warn('[Enhanced Server] Error fetching latest server version:', e);
        return null;
    }
}

/**
 * Displays the download instructions modal loop until server.js is installed or the user cancels.
 */
export async function showMissingServerInstructions(downloadUrl: string, serverDir: string): Promise<boolean> {
    let serverJsFound = false;

    while (!serverJsFound) {
        const result = await modalManager.showAlert(
            'info',
            'Streaming Server Setup Required',
            `To enable video playback, you need to download the Stremio streaming server file (server.js).\n\n` +
            `1. Download server.js from:\n${downloadUrl}\n\n` +
            `2. Right click the page and select "Save As" and save it as "server.js".\n\n` +
            `3. Place it in:\n${serverDir}\n\n` +
            `Click "Open Folder" to open the destination folder, or "Download" to open the download link in your browser. Click "Close" when you have placed the file in the correct location and the streaming server will start.`,
            ['Open Folder', 'Download', 'Close']
        );

        if (result === 0) {
            openStreamingServerFolder();
        } else if (result === 1) {
            window.open(downloadUrl, '_blank');
        } else {
            // User clicked Close - check if file exists now
            const freshStatus = await getServerStatus();
            if (freshStatus && freshStatus.exists) {
                serverJsFound = true;
                console.log('[Enhanced Server] server.js found after user action. Starting streaming server...');
                const started = await startStreamingServer();
                if (started) {
                    await modalManager.showAlert(
                        'info',
                        'Streaming Server Setup Complete',
                        'The streaming server has been set up successfully. The application will now reload to use the local streaming server (127.0.0.1).',
                        ['OK']
                    );
                    reloadToLocalStreamingServer();
                }
                return true;
            } else {
                const warnResult = await modalManager.showAlert(
                    'warning',
                    'File Not Found',
                    `server.js was not found in:\n${serverDir}\n\nPlease download the file and place it in the correct location. Do you want to try again?`,
                    ['Try Again', 'Close']
                );

                if (warnResult === 1) {
                    serverJsFound = true;
                    return false;
                }
            }
        }
    }

    return false;
}

/**
 * Checks for streaming server availability and updates.
 * Prompts the user with instructions if server.js is missing or if an update is available.
 */
export async function checkServerJsUpdateAndSetup(isManual = false): Promise<void> {
    if (isCheckingServer) return;
    isCheckingServer = true;

    if (isManual) {
        modalManager.showToast(
            'checking-server-update',
            'Checking Server',
            'Checking for streaming server updates...',
            'info'
        );
    }

    try {
        const status = await getServerStatus();
        const serverDir = status.serverDir;

        const remote = await fetchLatestServerVersion();
        const latestVersion = remote?.version || 'v4.21.1';
        const downloadUrl = remote?.downloadUrl || DEFAULT_SERVER_JS_URL;
        latestServerJsUrl = downloadUrl;

        if (!status.exists) {
            console.log('[Enhanced Server] server.js not found. Showing download instructions to user...');
            hasPromptedInitialSetup = true;
            await showMissingServerInstructions(downloadUrl, serverDir);
        } else {
            // If server exists but is stopped, start it; if already running and currently on web.stremio.com, reload to 127.0.0.1
            if (!status.running) {
                console.log('[Enhanced Server] server.js exists but is not running. Starting streaming server...');
                const started = await startStreamingServer();
                if (started && window.location.hostname !== '127.0.0.1') {
                    reloadToLocalStreamingServer();
                    return;
                }
            } else if (window.location.hostname !== '127.0.0.1') {
                console.log('[Enhanced Server] Streaming server is running. Switching from web.stremio.com to 127.0.0.1...');
                reloadToLocalStreamingServer();
                return;
            }

            // Server exists - check for update if version is known
            const currentVer = status.currentVersion;
            const skippedVer = status.skippedVersion;

            const isDifferent = remote && currentVer && (isNewerVersion(latestVersion, currentVer) || latestVersion !== currentVer);
            if (isDifferent && latestVersion !== skippedVer) {
                const promptMessage = `A new version of the Stremio local server (${latestVersion}) is available. Do you want to update it now?`;
                const response = await modalManager.showAlert(
                    'question',
                    'Server Update',
                    promptMessage,
                    ['Yes', 'No', "No and don't ask again"]
                );

                if (response === 0) {
                    // User agreed to update
                    postEnhancedMessage('prepareServerUpdate', { version: latestVersion });
                    await showMissingServerInstructions(downloadUrl, serverDir);
                } else if (response === 2) {
                    // Do not ask again for this version
                    postEnhancedMessage('skipServerVersion', { version: latestVersion });
                }
            } else if (isManual) {
                modalManager.showToast(
                    'server-up-to-date',
                    'Server Up to Date',
                    `Streaming server is up to date (${currentVer || latestVersion}).`,
                    'info'
                );
            }
        }
    } catch (e: any) {
        console.error('[Enhanced Server] Error during server check:', e);
        if (isManual) {
            modalManager.showToast(
                'server-check-error',
                'Check Failed',
                `Failed to check for server updates: ${e?.message || e}`,
                'fail'
            );
        }
    } finally {
        isCheckingServer = false;
    }
}
