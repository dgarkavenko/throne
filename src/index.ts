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
      .status-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .status {
        font-size: 0.9rem;
        opacity: 0.8;
      }
      body.connected .setup-controls,
      body.connected .share-controls,
      body.connected .hint {
        display: none;
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
      .player.self {
        pointer-events: auto;
      }
      .player .emoji {
        font-size: 1.35rem;
        filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.35));
      }
      .player input {
        font-size: 0.75rem;
        background: rgba(0, 0, 0, 0.6);
        padding: 0.15rem 0.4rem;
        border-radius: 0.4rem;
        white-space: nowrap;
        border: 1px solid color-mix(in srgb, var(--color, #f97316) 70%, transparent);
        color: inherit;
        text-align: center;
        min-width: 6rem;
        pointer-events: none;
      }
      .player.self input {
        pointer-events: auto;
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
        <div class="controls setup-controls">
          <input id="room" placeholder="Room code" />
          <button id="host">Host room</button>
          <button id="join" class="secondary">Join room</button>
        </div>
        <div class="controls share-controls">
          <input id="share-link" readonly placeholder="Share link" />
          <button id="copy" class="secondary">Copy link</button>
        </div>
        <div class="status-row">
          <div class="status" id="status">Not connected</div>
          <button id="leave" class="secondary" disabled>Leave</button>
        </div>
      </header>
      <section id="field"></section>
    </main>

    <script>
      const field = document.getElementById('field');
      const statusEl = document.getElementById('status');
      const roomInput = document.getElementById('room');
      const hostBtn = document.getElementById('host');
      const joinBtn = document.getElementById('join');
      const leaveBtn = document.getElementById('leave');
      const shareLinkInput = document.getElementById('share-link');
      const copyBtn = document.getElementById('copy');

      let socket;
      let playerId = null;
      const players = new Map();
      const playerElements = new Map();
      const emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];

      function updateShareLink() {
        const room = roomInput.value.trim();
        if (!room) {
          shareLinkInput.value = '';
          return;
        }
        const params = new URLSearchParams();
        params.set('room', room);
        shareLinkInput.value = location.origin + '/?' + params.toString();
      }

      function updateStatus(message) {
        statusEl.textContent = message;
      }

      function createPlayerElement(player) {
        const el = document.createElement('div');
        el.className = 'player';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Say something';
        input.maxLength = 48;
        const emoji = document.createElement('div');
        emoji.className = 'emoji';
        el.append(input, emoji);
        input.addEventListener('input', () => {
          if (player.id !== playerId) {
            return;
          }
          send({ type: 'text', text: input.value });
        });
        return el;
      }

      function updatePlayerElement(el, player) {
        el.style.left = player.x + 'px';
        el.style.top = player.y + 'px';
        el.style.setProperty('--color', player.color);
        el.classList.toggle('self', player.id === playerId);
        const emoji = el.querySelector('.emoji');
        if (emoji) {
          emoji.textContent = player.emoji || emojis[0];
        }
        const input = el.querySelector('input');
        if (input) {
          const isSelf = player.id === playerId;
          input.readOnly = !isSelf;
          input.tabIndex = isSelf ? 0 : -1;
          if (!isSelf || document.activeElement !== input) {
            input.value = player.text || '';
          }
        }
      }

      function renderPlayers() {
        const activeIds = new Set(players.keys());
        for (const player of players.values()) {
          let el = playerElements.get(player.id);
          if (!el) {
            el = createPlayerElement(player);
            playerElements.set(player.id, el);
            field.appendChild(el);
          }
          updatePlayerElement(el, player);
        }
        for (const [id, el] of playerElements.entries()) {
          if (!activeIds.has(id)) {
            el.remove();
            playerElements.delete(id);
          }
        }
      }

      function send(message) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      }

      function connect({ host }) {
        if (!roomInput.value.trim()) {
          roomInput.value = crypto.randomUUID().slice(0, 6);
        }
        updateShareLink();
        const roomId = roomInput.value.trim();
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = protocol + '://' + location.host + '/room/' + roomId + (host ? '?host=1' : '');
        socket = new WebSocket(url);

        socket.addEventListener('open', () => {
          updateStatus('Connected to ' + roomId);
          document.body.classList.add('connected');
          leaveBtn.disabled = false;
          hostBtn.disabled = true;
          joinBtn.disabled = true;
          send({ type: 'join' });
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
          document.body.classList.remove('connected');
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
      copyBtn.addEventListener('click', async () => {
        if (!shareLinkInput.value) {
          return;
        }
        try {
          await navigator.clipboard.writeText(shareLinkInput.value);
          updateStatus('Link copied to clipboard.');
        } catch (error) {
          updateStatus('Copy failed. Select the link and copy manually.');
        }
      });

      roomInput.addEventListener('input', () => {
        updateShareLink();
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

      const params = new URLSearchParams(location.search);
      if (params.has('room')) {
        roomInput.value = params.get('room') || '';
      }
      updateShareLink();

      if (roomInput.value.trim()) {
        connect({ host: false });
      }
    </script>
  </body>
</html>`;

interface PlayerState {
  id: string;
  x: number;
  y: number;
  color: string;
  emoji: string;
  text: string;
}

interface RoomMessage {
  type: 'join' | 'move' | 'text';
  x?: number;
  y?: number;
  text?: string;
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];

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
      x: 120,
      y: 120,
      color: this.pickColor(),
      emoji: this.pickEmoji(),
      text: '',
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

      if (message.type === 'move') {
        if (typeof message.x === 'number') {
          player.x = message.x;
        }
        if (typeof message.y === 'number') {
          player.y = message.y;
        }
      }

      if (message.type === 'text' && typeof message.text === 'string') {
        player.text = message.text.slice(0, 48);
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
      if (message.type === 'join' || message.type === 'move' || message.type === 'text') {
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

  private pickEmoji() {
    return this.emojis[Math.floor(Math.random() * this.emojis.length)];
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
