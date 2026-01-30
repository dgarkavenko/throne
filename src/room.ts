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

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private emojis = ['\ud83d\udc99', '\ud83d\udd25', '\ud83c\udf1c', '\u2728', '\ud83d\udc7e', '\ud83d\udc8e', '\ud83c\udf38', '\ud83c\udf19', '\ud83e\uddf8', '\ud83e\udee7', '\ud83c\udf2c\ufe0f', '\ud83c\udf89'];
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
      color: player.color,
      emoji: player.emoji,
    });

    for (const socket of this.connections.keys()) {
      try {
        socket.send(payload);
      } catch (error) {
        this.connections.delete(socket);
      }
    }
  }

  private pickEmoji(): string {
    const emoji = this.emojis[Math.floor(Math.random() * this.emojis.length)];
    return emoji ?? '\ud83e\udee7';
  }

  private pickColor(): string {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    return color ?? '#f5f5f5';
  }
}
