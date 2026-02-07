import type { HistoryEntry, LaunchMessage, PlayerState, ServerMessage } from '../types';

type ConnectionEvents = {
  onStatus?: (message: string) => void;
  onConnected?: (roomId: string) => void;
  onDisconnected?: () => void;
  onWelcome?: (playerId: string) => void;
  onState?: (players: PlayerState[], sessionStart: number | null) => void;
  onHistory?: (messages: HistoryEntry[]) => void;
  onLaunch?: (message: LaunchMessage) => void;
};

type Connection = {
  sendTyping: (text: string) => void;
  sendLaunch: (text: string) => void;
};

export function connectToRoom(events: ConnectionEvents = {}): Connection {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'lobby';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol + '://' + location.host + '/room/' + roomId;
  const socket = new WebSocket(url);

  const connectTimeout = window.setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      events.onStatus?.('Unable to connect. Check the server and refresh.');
    }
  }, 4000);

  socket.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    events.onStatus?.('Connected to room ' + roomId + '.');
    events.onConnected?.(roomId);
    socket.send(JSON.stringify({ type: 'join' }));
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data) as ServerMessage;
    if (payload.type === 'welcome') {
      events.onWelcome?.(payload.id);
    }
    if (payload.type === 'state') {
      events.onState?.(payload.players || [], typeof payload.sessionStart === 'number' ? payload.sessionStart : null);
    }
    if (payload.type === 'history' && Array.isArray(payload.messages)) {
      events.onHistory?.(payload.messages);
    }
    if (payload.type === 'launch') {
      events.onLaunch?.(payload);
    }
  });

  socket.addEventListener('error', () => {
    events.onStatus?.('Connection error. Refresh to retry.');
  });

  socket.addEventListener('close', () => {
    events.onStatus?.('Disconnected. Refresh to reconnect.');
    events.onDisconnected?.();
  });

  return {
    sendTyping(text) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'typing',
          text,
        })
      );
    },
    sendLaunch(text) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'launch',
          text,
        })
      );
    },
  };
}
