import { postEnhancedMessage } from './dom';

export function setupLogger(): void {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    function formatConsoleArgs(args: any[]): string {
        return Array.from(args).map(arg => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) {
                return arg.stack || `${arg.name}: ${arg.message}`;
            }
            if (typeof arg === 'object' && arg !== null) {
                if (arg.message) return `${arg.name || 'Error'}: ${arg.message}`;
                try {
                    const json = JSON.stringify(arg);
                    return json === '{}' ? String(arg) : json;
                } catch (_) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }

    const WATCHED_LOG_TAGS = ['[TheIntroDB]', '[Enhanced]', '[Plugin]', 'Episode ID:', '[Aptabase]'];

    function hasWatchedTag(args: any[]): boolean {
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (typeof arg === 'string') {
                for (let j = 0; j < WATCHED_LOG_TAGS.length; j++) {
                    if (arg.includes(WATCHED_LOG_TAGS[j])) return true;
                }
            } else if (arg instanceof Error) {
                const text = `${arg.name || ''} ${arg.message || ''}`;
                for (let j = 0; j < WATCHED_LOG_TAGS.length; j++) {
                    if (text.includes(WATCHED_LOG_TAGS[j])) return true;
                }
            }
        }
        return false;
    }

    console.log = function (...args: any[]) {
        origLog(...args);
        if (!hasWatchedTag(args)) return;
        const msg = formatConsoleArgs(args);
        postEnhancedMessage('log', { level: 'info', message: msg });
    };

    console.warn = function (...args: any[]) {
        origWarn(...args);
        if (!hasWatchedTag(args)) return;
        const msg = formatConsoleArgs(args);
        postEnhancedMessage('log', { level: 'warn', message: msg });
    };

    console.error = function (...args: any[]) {
        origError(...args);
        const msg = formatConsoleArgs(args);
        postEnhancedMessage('log', { level: 'error', message: msg });
    };

    window.addEventListener('error', (event) => {
        postEnhancedMessage('log', {
            level: 'error',
            message: `Uncaught JS error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
        });
    });
}
