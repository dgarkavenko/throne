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
  vx: number;
  vy: number;
  createdAt: number;
  updatedAt: number;
}

const GRAVITY = 1600;
const JUMP_VELOCITY = -380;

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];
  private messages: MessageState[] = [];
  private ready: Promise<void>;

  constructor(private state: DurableObjectState) {
    this.ready = this.state.storage.get<MessageState[]>('messages').then((stored) => {
      if (Array.isArray(stored)) {
        this.messages = stored.map((message) => this.normalizeMessage(message));
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
          const now = Date.now();
          this.messages.push({
            id: crypto.randomUUID(),
            text: trimmed,
            color: player.color,
            x: player.x,
            y: Math.max(0, player.y - 60),
            vx: 0,
            vy: JUMP_VELOCITY,
            createdAt: now,
            updatedAt: now,
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
    const now = Date.now();
    this.advancePhysics(now);

    const payload = JSON.stringify({
      type: 'state',
      players: Array.from(this.connections.values()),
      hostId: this.hostId,
      messages: this.messages,
      serverTime: now,
    });

    for (const socket of this.connections.keys()) {
      try {
        socket.send(payload);
      } catch (error) {
        this.connections.delete(socket);
      }
    }
  }

  private advancePhysics(now: number) {
    for (const message of this.messages) {
      const dt = Math.max(0, (now - message.updatedAt) / 1000);
      if (dt === 0) {
        continue;
      }
      message.vy += GRAVITY * dt;
      message.y += message.vy * dt;
      message.updatedAt = now;
    }
  }

  private normalizeMessage(message: MessageState): MessageState {
    const now = Date.now();
    return {
      id: message.id,
      text: message.text,
      color: message.color,
      x: message.x,
      y: message.y,
      vx: Number.isFinite(message.vx) ? message.vx : 0,
      vy: Number.isFinite(message.vy) ? message.vy : 0,
      createdAt: Number.isFinite(message.createdAt) ? message.createdAt : now,
      updatedAt: Number.isFinite(message.updatedAt) ? message.updatedAt : now,
    };
  }

  private pickColor() {
    const palette = ['#f97316', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#facc15'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  private pickEmoji() {
    return this.emojis[Math.floor(Math.random() * this.emojis.length)];
  }
}
