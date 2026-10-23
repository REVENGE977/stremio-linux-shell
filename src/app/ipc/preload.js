const createIpc = () => {
    let listeners = [];

    globalThis.__postMessage = (data) => {
        listeners.forEach((listener) => {
            listener({ data });
        });
    };

    const postMessage = (data) => {
        globalThis.webkit.messageHandlers.ipc.postMessage(data);
    };

    const addEventListener = (name, listener) => {
        if (name !== 'message')
            throw Error('Unsupported event');

        listeners.push(listener);
    };

    const removeEventListener = (name, listener) => {
        if (name !== 'message')
            throw Error('Unsupported event');

        listeners = listeners.filter((it) => it !== listener);
    };

    return {
        postMessage,
        addEventListener,
        removeEventListener,
    };
};

window.ipc = createIpc();

// Backward compatibility
const webChannelTransport = {
    send: window.ipc.postMessage,
};

let webChannelQueue = [];
let webChannelOnMessage = null;

Object.defineProperty(webChannelTransport, 'onmessage', {
    get() {
        return webChannelOnMessage;
    },
    set(fn) {
        webChannelOnMessage = fn;
        if (typeof fn === 'function') {
            while (webChannelQueue.length > 0) {
                const msg = webChannelQueue.shift();
                try {
                    fn(msg);
                } catch (e) {
                    console.error('[WebChannel] Error delivering queued message:', e);
                }
            }
        }
    },
    configurable: true,
});

window.qt = {
    webChannelTransport: webChannelTransport,
};

globalThis.chrome = {
    webview: {
        postMessage: window.ipc.postMessage,
        addEventListener: (name, listener) => {
            window.ipc.addEventListener(name, listener);
        },
        removeEventListener: (name, listener) => {
            window.ipc.removeEventListener(name, listener);
        },
    },
};

window.ipc.addEventListener('message', (message) => {
    if (typeof webChannelOnMessage === 'function') {
        try {
            webChannelOnMessage(message);
        } catch (e) {
            console.error('[WebChannel] Error in onmessage:', e);
        }
    } else {
        webChannelQueue.push(message);
    }
});

window.stremio_server_ipc_key = "LINUX";

console.log('IPC script injected');