// Node 20 has no global WebSocket; @supabase/supabase-js crashes on createClient.
// Auth/storage on this API do not use Realtime — provide a closed stub if needed.
if (typeof globalThis.WebSocket !== 'function') {
    globalThis.WebSocket = class NoopWebSocket {
        constructor() {
            this.readyState = 3;
        }

        send() {}

        close() {}

        addEventListener() {}

        removeEventListener() {}
    };
}
