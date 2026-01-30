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
        cursor: none;
      }
      .player {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.2rem;
        pointer-events: none;
      }
      .player.self {
        pointer-events: auto;
      }
      .player .emoji {
        font-size: 2.6rem;
        filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.35));
      }
      .bubble {
        position: relative;
        background: #ffffff;
        border-radius: 999px;
        padding: 0.25rem 0.5rem;
        min-width: 6rem;
        min-height: 1.5rem;
        border: 2px solid color-mix(in srgb, var(--color, #f97316) 70%, #ffffff);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
      }
      .bubble::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: -0.4rem;
        transform: translateX(-50%) rotate(45deg);
        width: 0.7rem;
        height: 0.7rem;
        background: #ffffff;
        border: 2px solid color-mix(in srgb, var(--color, #f97316) 70%, #ffffff);
        border-top: none;
        border-left: none;
        border-bottom-right-radius: 0.35rem;
      }
      .bubble-input {
        font-size: 0.8rem;
        border: none;
        background: transparent;
        color: var(--color, #f97316);
        text-align: center;
        width: 6ch;
        min-width: 6ch;
        outline: none;
        cursor: none;
      }
      .player.self .bubble-input {
        pointer-events: auto;
      }
      .player .bubble-input {
        pointer-events: none;
      }
      .message {
        position: absolute;
        transform: translate(-50%, -50%);
        background: #ffffff;
        color: var(--color, #f97316);
        padding: 0.35rem 0.75rem;
        border-radius: 999px;
        border: 2px solid color-mix(in srgb, var(--color, #f97316) 70%, #ffffff);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.4);
        font-size: 0.85rem;
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
      body {
        cursor: none;
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
      const messages = new Map();
      const playerElements = new Map();
      const messageElements = new Map();
      const emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];
      let serverTimeOffset = 0;
      const gravity = 1600;
      let animationFrame = null;

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
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = ' ';
        input.maxLength = 48;
        input.className = 'bubble-input';
        const emoji = document.createElement('div');
        emoji.className = 'emoji';
        bubble.append(input);
        el.append(bubble, emoji);
        input.addEventListener('input', () => {
          if (player.id !== playerId) {
            return;
          }
          send({ type: 'text', text: input.value });
          updateBubbleSize(input);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') {
            return;
          }
          if (player.id !== playerId) {
            return;
          }
          event.preventDefault();
          const text = input.value.trim();
          if (text.length > 0) {
            send({ type: 'drop', text });
          }
          input.value = '';
          send({ type: 'text', text: '' });
          updateBubbleSize(input);
        });
        input.addEventListener('blur', () => {
          if (player.id === playerId) {
            requestAnimationFrame(() => input.focus({ preventScroll: true }));
          }
        });
        return el;
      }

      function updateBubbleSize(input) {
        const length = Math.max(1, input.value.length + 1);
        input.style.width = Math.max(6, length) + 'ch';
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
          updateBubbleSize(input);
          if (isSelf && document.activeElement !== input) {
            input.focus({ preventScroll: true });
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

      function createMessageElement(message) {
        const el = document.createElement('div');
        el.className = 'message';
        el.textContent = message.text;
        return el;
      }

      function renderMessages() {
        const activeIds = new Set(messages.keys());
        for (const message of messages.values()) {
          let el = messageElements.get(message.id);
          if (!el) {
            el = createMessageElement(message);
            messageElements.set(message.id, el);
            field.appendChild(el);
          }
          el.textContent = message.text;
          el.style.setProperty('--color', message.color);
        }
        for (const [id, el] of messageElements.entries()) {
          if (!activeIds.has(id)) {
            el.remove();
            messageElements.delete(id);
          }
        }
        ensureAnimation();
      }

      function ensureAnimation() {
        if (animationFrame !== null) {
          return;
        }
        const tick = () => {
          const now = Date.now() + serverTimeOffset;
          const fieldHeight = field.clientHeight;
          const ground = fieldHeight - 16;
          for (const message of messages.values()) {
            const el = messageElements.get(message.id);
            if (!el) {
              continue;
            }
            const age = Math.max(0, (now - message.createdAt) / 1000);
            const height = el.offsetHeight || 0;
            const fall = message.y + 0.5 * gravity * age * age;
            const y = Math.min(fall, ground - height / 2);
            el.style.left = message.x + 'px';
            el.style.top = y + 'px';
          }
          animationFrame = requestAnimationFrame(tick);
        };
        animationFrame = requestAnimationFrame(tick);
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
            serverTimeOffset = payload.serverTime - Date.now();
            players.clear();
            for (const player of payload.players) {
              players.set(player.id, player);
            }
            messages.clear();
            for (const message of payload.messages || []) {
              messages.set(message.id, message);
            }
            renderPlayers();
            renderMessages();
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
          messages.clear();
          renderPlayers();
          renderMessages();
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
  type: 'join' | 'move' | 'text' | 'drop';
  x?: number;
  y?: number;
  text?: string;
}

interface MessageState {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  createdAt: number;
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];
  private messages: MessageState[] = [];
  private ready: Promise<void>;

  constructor(private state: DurableObjectState) {
    this.ready = this.state.storage.get<MessageState[]>('messages').then((stored) => {
      if (Array.isArray(stored)) {
        this.messages = stored;
      }
    });
  }

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
    await this.handleSession(server, isHost);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleSession(socket: WebSocket, isHost: boolean) {
    await this.ready;
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

      if (message.type === 'drop' && typeof message.text === 'string') {
        const trimmed = message.text.trim().slice(0, 48);
        if (trimmed.length > 0) {
          this.messages.push({
            id: crypto.randomUUID(),
            text: trimmed,
            color: player.color,
            x: player.x,
            y: Math.max(0, player.y - 60),
            createdAt: Date.now(),
          });
          void this.state.storage.put('messages', this.messages);
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
      if (
        message.type === 'join' ||
        message.type === 'move' ||
        message.type === 'text' ||
        message.type === 'drop'
      ) {
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
      messages: this.messages,
      serverTime: Date.now(),
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
