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
      #field canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .hint {
        font-size: 0.85rem;
        opacity: 0.7;
      }
      .chat-controls input {
        min-width: 16rem;
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
        <div class="controls chat-controls">
          <input id="message-input" placeholder="Type a message" disabled />
        </div>
      </header>
      <section id="field">
        <canvas id="scene"></canvas>
      </section>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/planck-js@0.3.0/dist/planck.min.js"></script>
    <script>
      const field = document.getElementById('field');
      const canvas = document.getElementById('scene');
      const statusEl = document.getElementById('status');
      const roomInput = document.getElementById('room');
      const hostBtn = document.getElementById('host');
      const joinBtn = document.getElementById('join');
      const leaveBtn = document.getElementById('leave');
      const shareLinkInput = document.getElementById('share-link');
      const copyBtn = document.getElementById('copy');
      const messageInput = document.getElementById('message-input');

      let socket;
      let playerId = null;
      const players = new Map();
      const messages = new Map();
      const emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];
      const playerSprites = new Map();
      const messageSprites = new Map();
      const playerBodies = new Map();
      const messageBodies = new Map();

      const pixiApp = new PIXI.Application({
        view: canvas,
        resizeTo: field,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
      });

      const physicsScale = 30;
      const physicsWorld = new planck.World({
        gravity: planck.Vec2(0, 30),
      });
      let boundsBody = null;
      let canvasWidth = 0;
      let canvasHeight = 0;
      let animationStarted = false;
      const timeStep = 1 / 60;
      let accumulator = 0;

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

      function syncMessageInput() {
        if (!messageInput || !playerId) {
          return;
        }
        const me = players.get(playerId);
        if (!me) {
          return;
        }
        if (document.activeElement !== messageInput) {
          messageInput.value = me.text || '';
        }
      }

      function toWorld(value) {
        return value / physicsScale;
      }

      function toPixels(value) {
        return value * physicsScale;
      }

      function syncBounds() {
        const rect = field.getBoundingClientRect();
        const nextWidth = Math.max(1, Math.floor(rect.width));
        const nextHeight = Math.max(1, Math.floor(rect.height));
        if (nextWidth === canvasWidth && nextHeight === canvasHeight) {
          return;
        }
        canvasWidth = nextWidth;
        canvasHeight = nextHeight;
        rebuildBounds();
      }

      function rebuildBounds() {
        if (boundsBody) {
          physicsWorld.destroyBody(boundsBody);
        }
        boundsBody = physicsWorld.createBody();
        const width = toWorld(canvasWidth);
        const groundHeight = toWorld(Math.max(0, canvasHeight - 16));
        boundsBody.createFixture(planck.Edge(planck.Vec2(0, 0), planck.Vec2(width, 0)));
        boundsBody.createFixture(planck.Edge(planck.Vec2(0, 0), planck.Vec2(0, groundHeight)));
        boundsBody.createFixture(planck.Edge(planck.Vec2(width, 0), planck.Vec2(width, groundHeight)));
        boundsBody.createFixture(planck.Edge(planck.Vec2(0, groundHeight), planck.Vec2(width, groundHeight)));
      }

      function createPlayerSprite(player) {
        const container = new PIXI.Container();
        const bubble = new PIXI.Graphics();
        const bubbleText = new PIXI.Text('', {
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 13,
          fill: player.color,
          align: 'center',
        });
        bubbleText.anchor.set(0.5);
        const emojiText = new PIXI.Text(player.emoji || emojis[0], {
          fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          fontSize: 32,
        });
        emojiText.anchor.set(0.5);
        container.addChild(bubble);
        container.addChild(bubbleText);
        container.addChild(emojiText);
        pixiApp.stage.addChild(container);
        const sprite = { container, bubble, bubbleText, emojiText };
        updatePlayerSprite(player, sprite);
        return sprite;
      }

      function updatePlayerSprite(player, sprite) {
        sprite.emojiText.text = player.emoji || emojis[0];
        sprite.bubbleText.style.fill = player.color;
        const text = player.text || '';
        if (!text) {
          sprite.bubble.visible = false;
          sprite.bubbleText.visible = false;
          return;
        }
        sprite.bubble.visible = true;
        sprite.bubbleText.visible = true;
        sprite.bubbleText.text = text;
        const paddingX = 12;
        const paddingY = 5;
        const width = Math.max(96, sprite.bubbleText.width + paddingX * 2);
        const height = Math.max(26, sprite.bubbleText.height + paddingY * 2);
        const color = PIXI.utils.string2hex(player.color);
        sprite.bubble.clear();
        sprite.bubble.beginFill(0xffffff);
        sprite.bubble.lineStyle(2, color);
        sprite.bubble.drawRoundedRect(-width / 2, -height / 2, width, height, height / 2);
        sprite.bubble.endFill();
        const emojiSize = 32;
        const gap = 6;
        const bubbleY = -emojiSize / 2 - gap - height / 2;
        sprite.bubble.position.set(0, bubbleY);
        sprite.bubbleText.position.set(0, bubbleY);
        sprite.bubbleText.anchor.set(0.5);
        sprite.emojiText.position.set(0, 0);
      }

      function createMessageSprite(message) {
        const container = new PIXI.Container();
        const bubble = new PIXI.Graphics();
        const bubbleText = new PIXI.Text(message.text, {
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 14,
          fill: message.color,
          align: 'center',
        });
        bubbleText.anchor.set(0.5);
        container.addChild(bubble);
        container.addChild(bubbleText);
        pixiApp.stage.addChild(container);
        const sprite = { container, bubble, bubbleText, width: 0, height: 0 };
        updateMessageSprite(message, sprite);
        return sprite;
      }

      function updateMessageSprite(message, sprite) {
        sprite.bubbleText.text = message.text;
        sprite.bubbleText.style.fill = message.color;
        const paddingX = 14;
        const paddingY = 6;
        const width = Math.max(96, sprite.bubbleText.width + paddingX * 2);
        const height = Math.max(26, sprite.bubbleText.height + paddingY * 2);
        sprite.width = width;
        sprite.height = height;
        const color = PIXI.utils.string2hex(message.color);
        sprite.bubble.clear();
        sprite.bubble.beginFill(0xffffff);
        sprite.bubble.lineStyle(2, color);
        sprite.bubble.drawRoundedRect(-width / 2, -height / 2, width, height, height / 2);
        sprite.bubble.endFill();
      }

      function createPlayerBody(player) {
        const body = physicsWorld.createKinematicBody({
          position: planck.Vec2(toWorld(player.x), toWorld(player.y)),
        });
        body.createFixture(planck.Circle(toWorld(18)), {
          density: 1,
        });
        return body;
      }

      function createMessageBody(message, sprite) {
        const body = physicsWorld.createDynamicBody({
          position: planck.Vec2(toWorld(message.x), toWorld(message.y)),
        });
        body.createFixture(
          planck.Box(toWorld(sprite.width / 2), toWorld(sprite.height / 2)),
          {
            density: 1,
            friction: 0.35,
            restitution: 0.1,
          }
        );
        return body;
      }

      function clearEntities() {
        for (const body of playerBodies.values()) {
          physicsWorld.destroyBody(body);
        }
        for (const body of messageBodies.values()) {
          physicsWorld.destroyBody(body);
        }
        for (const sprite of playerSprites.values()) {
          pixiApp.stage.removeChild(sprite.container);
        }
        for (const sprite of messageSprites.values()) {
          pixiApp.stage.removeChild(sprite.container);
        }
        playerBodies.clear();
        messageBodies.clear();
        playerSprites.clear();
        messageSprites.clear();
        players.clear();
        messages.clear();
      }

      function stepPhysics(deltaSeconds) {
        accumulator = Math.min(accumulator + deltaSeconds, 0.25);
        while (accumulator >= timeStep) {
          for (const [id, player] of players.entries()) {
            const body = playerBodies.get(id);
            if (body) {
              body.setTransform(planck.Vec2(toWorld(player.x), toWorld(player.y)), 0);
            }
          }
          physicsWorld.step(timeStep);
          accumulator -= timeStep;
        }

        for (const [id, sprite] of playerSprites.entries()) {
          const body = playerBodies.get(id);
          if (!body) continue;
          const position = body.getPosition();
          sprite.container.position.set(toPixels(position.x), toPixels(position.y));
        }

        for (const [id, sprite] of messageSprites.entries()) {
          const body = messageBodies.get(id);
          if (!body) continue;
          const position = body.getPosition();
          sprite.container.position.set(toPixels(position.x), toPixels(position.y));
        }
      }

      function ensureAnimation() {
        if (animationStarted) {
          return;
        }
        animationStarted = true;
        syncBounds();
        pixiApp.ticker.add(() => {
          syncBounds();
          stepPhysics(pixiApp.ticker.deltaMS / 1000);
        });
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
          messageInput.disabled = false;
          messageInput.focus({ preventScroll: true });
          send({ type: 'join' });
        });

        socket.addEventListener('message', (event) => {
          const payload = JSON.parse(event.data);
          if (payload.type === 'welcome') {
            playerId = payload.id;
          }
          if (payload.type === 'state') {
            syncBounds();
            const nextPlayers = new Set();
            for (const player of payload.players) {
              nextPlayers.add(player.id);
              const existing = players.get(player.id);
              if (existing) {
                Object.assign(existing, player);
                const sprite = playerSprites.get(player.id);
                if (sprite) {
                  updatePlayerSprite(existing, sprite);
                }
              } else {
                players.set(player.id, player);
                const sprite = createPlayerSprite(player);
                playerSprites.set(player.id, sprite);
                const body = createPlayerBody(player);
                playerBodies.set(player.id, body);
              }
            }
            for (const [id, sprite] of playerSprites.entries()) {
              if (!nextPlayers.has(id)) {
                pixiApp.stage.removeChild(sprite.container);
                playerSprites.delete(id);
                const body = playerBodies.get(id);
                if (body) {
                  physicsWorld.destroyBody(body);
                  playerBodies.delete(id);
                }
                players.delete(id);
              }
            }

            const nextMessages = new Set();
            for (const message of payload.messages || []) {
              nextMessages.add(message.id);
              if (!messages.has(message.id)) {
                messages.set(message.id, message);
                const sprite = createMessageSprite(message);
                messageSprites.set(message.id, sprite);
                const body = createMessageBody(message, sprite);
                messageBodies.set(message.id, body);
              }
            }
            for (const [id, sprite] of messageSprites.entries()) {
              if (!nextMessages.has(id)) {
                pixiApp.stage.removeChild(sprite.container);
                messageSprites.delete(id);
                const body = messageBodies.get(id);
                if (body) {
                  physicsWorld.destroyBody(body);
                  messageBodies.delete(id);
                }
                messages.delete(id);
              }
            }
            syncMessageInput();
            ensureAnimation();
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
          messageInput.disabled = true;
          messageInput.value = '';
          clearEntities();
          syncMessageInput();
          ensureAnimation();
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

      messageInput.addEventListener('input', () => {
        if (!playerId) {
          return;
        }
        send({ type: 'text', text: messageInput.value });
      });

      messageInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        const text = messageInput.value.trim();
        if (text.length > 0) {
          send({ type: 'drop', text });
        }
        messageInput.value = '';
        send({ type: 'text', text: '' });
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
        syncBounds();
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
      ensureAnimation();
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
