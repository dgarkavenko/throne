interface PlayerState {
  id: string;
  emoji: string;
  typing: string;
  color: string;
}

interface RoomMessage {
  type: 'join' | 'typing' | 'launch';
  text?: string;
}

interface RoomHistoryEntry {
  text: string;
  color: string;
  emoji: string;
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private sessionStart: number | null = null;
  private history: RoomHistoryEntry[] = [];
  private emojis = [
    '\ud83e\udd34',
    '\ud83d\udc78',
    '\ud83e\udec5',
    '\ud83e\uddd9',
    '\ud83e\uddd9\u200d\u2640\ufe0f',
    '\ud83e\uddd9\u200d\u2642\ufe0f',
    '\ud83e\udddd',
    '\ud83e\udddd\u200d\u2640\ufe0f',
    '\ud83e\udddd\u200d\u2642\ufe0f',
    '\ud83e\udd3a',
    '\ud83d\udc68\u200d\ud83c\udf3e',
    '\ud83d\udc69\u200d\ud83c\udf3e',
  ];
  private colors = ['#f6c1c7', '#f7d6b2', '#f8f1b4', '#c7f0d9', '#c4d7f7', '#d9c4f7', '#f7c4e3', '#c7f3f6', '#f6c7a6', '#d7f6b4', '#c9f6d7', '#f3c9f6'];

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleSession(socket: WebSocket) {
    socket.accept();

    const player: PlayerState = {
      id: crypto.randomUUID(),
      emoji: this.pickEmoji(),
      typing: '',
      color: this.pickColor(),
    };

    if (this.connections.size === 0) {
      this.hostId = player.id;
      this.sessionStart = Date.now();
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

      if (message.type === 'join') {
        this.broadcastState();
        this.sendHistory(socket);
      }
      if (message.type === 'typing') {
        const nextText = message.text ?? '';
        const entry = this.connections.get(socket);
        if (entry && entry.typing !== nextText) {
          entry.typing = nextText;
          this.connections.set(socket, entry);
        }
        this.broadcastState();
      }
      if (message.type === 'launch') {
        const entry = this.connections.get(socket);
        const text = (message.text ?? '').trim();
        if (!entry || !text) {
          return;
        }
        this.broadcastLaunch(text, entry);
      }
    });

    const cleanup = () => {
      this.connections.delete(socket);
      if (this.hostId === player.id) {
        this.hostId = null;
      }
      if (this.connections.size === 0) {
        this.sessionStart = null;
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
      if (message.type === 'join') {
        return message;
      }
      if (message.type === 'typing') {
        return {
          type: 'typing',
          text: typeof message.text === 'string' ? message.text : '',
        };
      }
      if (message.type === 'launch') {
        return {
          type: 'launch',
          text: typeof message.text === 'string' ? message.text : '',
        };
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
      sessionStart: this.sessionStart,
    });

    for (const socket of this.connections.keys()) {
      try {
        socket.send(payload);
      } catch (error) {
        this.connections.delete(socket);
      }
    }
  }

  private broadcastLaunch(text: string, player: PlayerState) {
    const payload = JSON.stringify({
      type: 'launch',
      text,
      id: player.id,
      color: player.color,
      emoji: player.emoji,
    });

    this.history.push({ text, color: player.color, emoji: player.emoji });
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    for (const socket of this.connections.keys()) {
      try {
        socket.send(payload);
      } catch (error) {
        this.connections.delete(socket);
      }
    }
  }

  private sendHistory(socket: WebSocket) {
    if (this.history.length === 0) {
      return;
    }
    const payload = JSON.stringify({
      type: 'history',
      messages: this.history,
    });
    try {
      socket.send(payload);
    } catch (error) {
      this.connections.delete(socket);
    }
  }

  private pickEmoji(): string {
    const emoji = this.emojis[Math.floor(Math.random() * this.emojis.length)];
    return emoji ?? '\ud83e\udd34';
  }

  private pickColor(): string {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    return color ?? '#f5f5f5';
  }
}
