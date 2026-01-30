interface PlayerState {
  id: string;
  emoji: string;
}

interface RoomMessage {
  type: 'join';
}

export class RoomDurableObject implements DurableObject {
  private connections = new Map<WebSocket, PlayerState>();
  private hostId: string | null = null;
  private emojis = ['\ud83d\udc99', '\ud83d\udd25', '\ud83c\udf1c', '\u2728', '\ud83d\udc7e', '\ud83d\udc8e', '\ud83c\udf38', '\ud83c\udf19', '\ud83e\uddf8', '\ud83e\udee7', '\ud83c\udf2c\ufe0f', '\ud83c\udf89'];

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

  private pickEmoji(): string {
    const emoji = this.emojis[Math.floor(Math.random() * this.emojis.length)];
    return emoji ?? '\ud83e\udee7';
  }
}
