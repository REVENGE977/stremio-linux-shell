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

    console.log = function (...args: any[]) {
        origLog(...args);
        const msg = formatConsoleArgs(args);
        if (msg.includes('[TheIntroDB]') || msg.includes('[Enhanced]') || msg.includes('[Plugin]') || msg.includes('Episode ID:') || msg.includes('[Aptabase]')) {
            postEnhancedMessage('log', { level: 'info', message: msg });
        }
    };

    console.warn = function (...args: any[]) {
        origWarn(...args);
        const msg = formatConsoleArgs(args);
        if (msg.includes('[TheIntroDB]') || msg.includes('[Enhanced]') || msg.includes('[Plugin]') || msg.includes('[Aptabase]')) {
            postEnhancedMessage('log', { level: 'warn', message: msg });
        }
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
