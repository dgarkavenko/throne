const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mouse Room</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #0f1115;
        color: #f5f5f5;
      }
      main {
        display: grid;
        grid-template-rows: auto 1fr;
        min-height: 100vh;
      }
      header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
        justify-content: space-between;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .controls input {
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: #1a1d24;
        color: inherit;
      }
      .controls button {
        padding: 0.5rem 0.9rem;
        border-radius: 0.5rem;
        border: none;
        background: #3b82f6;
        color: white;
        cursor: pointer;
        font-weight: 600;
      }
      .controls button.secondary {
        background: #272b35;
      }
      .status {
        font-size: 0.9rem;
        opacity: 0.8;
      }
      #field {
        position: relative;
        overflow: hidden;
        background: radial-gradient(circle at top left, #1f2937, #0f1115 50%);
      }
      .player {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
        pointer-events: none;
      }
      .player .dot {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: var(--color, #f97316);
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.35);
      }
      .player .label {
        font-size: 0.75rem;
        background: rgba(0, 0, 0, 0.6);
        padding: 0.15rem 0.4rem;
        border-radius: 0.4rem;
        white-space: nowrap;
      }
      .hint {
        font-size: 0.85rem;
        opacity: 0.7;
      }
      @media (max-width: 720px) {
        header {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Mouse Room</h1>
          <div class="hint">Host a room, then share the code so others can join.</div>
        </div>
        <div class="controls">
          <input id="name" placeholder="Your name" />
          <input id="room" placeholder="Room code" />
          <button id="host">Host room</button>
          <button id="join" class="secondary">Join room</button>
          <button id="leave" class="secondary" disabled>Leave</button>
        </div>
        <div class="status" id="status">Not connected</div>
      </header>
      <section id="field"></section>
    </main>

    <script>
      const field = document.getElementById('field');
      const statusEl = document.getElementById('status');
      const nameInput = document.getElementById('name');
      const roomInput = document.getElementById('room');
      const hostBtn = document.getElementById('host');
      const joinBtn = document.getElementById('join');
      const leaveBtn = document.getElementById('leave');

      let socket;
      let playerId = null;
      const players = new Map();
      const colors = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#facc15'];

      function updateStatus(message) {
        statusEl.textContent = message;
      }

      function renderPlayers() {
        field.innerHTML = '';
        for (const player of players.values()) {
          const el = document.createElement('div');
          el.className = 'player';
          el.style.left = player.x + 'px';
          el.style.top = player.y + 'px';
          el.style.setProperty('--color', player.color);
          el.innerHTML = '<div class=\"dot\"></div><div class=\"label\">' + player.name + '</div>';
          field.appendChild(el);
        }
      }

      function send(message) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      }

      function connect({ host }) {
        if (!nameInput.value.trim()) {
          updateStatus('Enter your name to connect.');
          return;
        }
        if (!roomInput.value.trim()) {
          roomInput.value = crypto.randomUUID().slice(0, 6);
        }
        const roomId = roomInput.value.trim();
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = protocol + '://' + location.host + '/room/' + roomId + (host ? '?host=1' : '');
        socket = new WebSocket(url);

        socket.addEventListener('open', () => {
          updateStatus('Connected to ' + roomId);
          leaveBtn.disabled = false;
          hostBtn.disabled = true;
          joinBtn.disabled = true;
          send({ type: 'join', name: nameInput.value.trim() });
        });

        socket.addEventListener('message', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.type === 'welcome') {
            playerId = payload.id;
          }
          if (payload.type === 'state') {
            players.clear();
            for (const player of payload.players) {
              players.set(player.id, player);
            }
            renderPlayers();
          }
          if (payload.type === 'error') {
            updateStatus(payload.message);
          }
        });

        socket.addEventListener('close', () => {
          updateStatus('Disconnected');
          leaveBtn.disabled = true;
          hostBtn.disabled = false;
          joinBtn.disabled = false;
          players.clear();
          renderPlayers();
        });
      }

      hostBtn.addEventListener('click', () => connect({ host: true }));
      joinBtn.addEventListener('click', () => connect({ host: false }));
      leaveBtn.addEventListener('click', () => {
        socket?.close();
      });

      let lastSent = 0;
      field.addEventListener('pointermove', (event) => {
        const now = performance.now();
        if (now - lastSent < 40) return;
        lastSent = now;
        const rect = field.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        send({ type: 'move', x, y });
      });

      window.addEventListener('resize', () => {
        if (playerId && players.has(playerId)) {
          const me = players.get(playerId);
          send({ type: 'move', x: me.x, y: me.y });
        }
      });
    </script>
  </body>
</html>`;

interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
}

interface RoomMessage {
  type: 'join' | 'move';
  name?: string;
  x?: number;
  y?: number;
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const url = new URL(request.url);
    const isHost = url.searchParams.get('host') === '1';

    if (!isHost && this.connections.size === 0) {
      return new Response('Room is closed.', { status: 410 });
    }

    if (isHost && this.connections.size > 0) {
      return new Response('Room already hosted.', { status: 409 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.handleSession(server, isHost);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleSession(socket: WebSocket, isHost: boolean) {
    socket.accept();

    const player: PlayerState = {
      id: crypto.randomUUID(),
      name: 'Guest',
      x: 120,
      y: 120,
      color: this.pickColor(),
    };

    if (isHost) {
      this.hostId = player.id;
    }

    this.connections.set(socket, player);

    socket.send(
      JSON.stringify({
        type: 'welcome',
        id: player.id,
      })
    );

    this.broadcastState();

    socket.addEventListener('message', (event) => {
      const message = this.parseMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === 'join' && message.name) {
        player.name = message.name.slice(0, 24);
      }

      if (message.type === 'move') {
        if (typeof message.x === 'number') {
          player.x = message.x;
        }
        if (typeof message.y === 'number') {
          player.y = message.y;
        }
      }

      this.broadcastState();
    });

    const cleanup = () => {
      this.connections.delete(socket);
      if (this.hostId === player.id) {
        this.hostId = null;
      }
      this.broadcastState();
    };

    socket.addEventListener('close', cleanup);
    socket.addEventListener('error', cleanup);
  }

  private parseMessage(data: string | ArrayBuffer): RoomMessage | null {
    if (typeof data !== 'string') {
      return null;
    }

    try {
      const message = JSON.parse(data) as RoomMessage;
      if (message.type === 'join' || message.type === 'move') {
        return message;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private broadcastState() {
    const payload = JSON.stringify({
      type: 'state',
      players: Array.from(this.connections.values()),
      hostId: this.hostId,
    });

    for (const socket of this.connections.keys()) {
      try {
        socket.send(payload);
      } catch (error) {
        this.connections.delete(socket);
      }
    }
  }

  private pickColor() {
    const palette = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#facc15'];
    return palette[Math.floor(Math.random() * palette.length)];
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    }

    if (url.pathname.startsWith('/room/')) {
      const roomId = url.pathname.replace('/room/', '').trim();
      if (!roomId) {
        return new Response('Room id required.', { status: 400 });
      }
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

interface Env {
  ROOMS: DurableObjectNamespace;
}
