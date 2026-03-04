import { io } from 'socket.io-client';

// In Docker: nginx proxies /socket.io/ → backend:3001 (same origin).
// In local dev: connect directly to localhost:3001.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || window.location.origin;

const socket = io(BACKEND_URL, {
    autoConnect: true,
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling'],
});

export default socket;
