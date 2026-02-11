import type {
  ActorCommandMessage,
  ActorRejectMessage,
  AgentsConfig,
  AgentsPublishClientMessage,
  PlayerState,
  ServerMessage,
  TerrainConfig,
  TerrainSnapshotMessage,
  WorldSnapshotMessage,
} from '../types';

type ConnectionEvents = {
  onStatus?: (message: string) => void;
  onConnected?: (roomId: string) => void;
  onDisconnected?: () => void;
  onWelcome?: (playerId: string) => void;
  onState?: (players: PlayerState[], sessionStart: number | null, hostId: string | null) => void;
  onTerrainSnapshot?: (message: TerrainSnapshotMessage) => void;
  onActorCommand?: (message: ActorCommandMessage) => void;
  onWorldSnapshot?: (message: WorldSnapshotMessage) => void;
  onActorReject?: (message: ActorRejectMessage) => void;
};

type Connection = {
  publishTerrainConfig: (terrain: TerrainConfig, clientVersion?: number) => void;
  publishAgentsConfig: (agents: AgentsConfig, clientVersion?: number) => void;
  sendActorMove: (actorId: string, targetFace: number, commandId: number, terrainVersion: number) => void;
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
      return;
    }
    if (payload.type === 'state') {
      events.onState?.(
        payload.players || [],
        typeof payload.sessionStart === 'number' ? payload.sessionStart : null,
        typeof payload.hostId === 'string' ? payload.hostId : null
      );
      return;
    }
    if (payload.type === 'terrain_snapshot') {
      events.onTerrainSnapshot?.(payload);
      return;
    }
    if (payload.type === 'actor_command') {
      events.onActorCommand?.(payload);
      return;
    }
    if (payload.type === 'world_snapshot') {
      events.onWorldSnapshot?.(payload);
      return;
    }
    if (payload.type === 'actor_reject') {
      events.onActorReject?.(payload);
    }
  });

  socket.addEventListener('error', () => {
    events.onStatus?.('Connection error. Refresh to retry.');
  });

  socket.addEventListener('close', () => {
    events.onStatus?.('Disconnected. Refresh to reconnect.');
    events.onDisconnected?.();
  });

  const send = (payload: object): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  };

  return {
    publishTerrainConfig(terrain, clientVersion = Date.now()) {
      send({
        type: 'terrain_publish',
        terrain,
        clientVersion,
      });
    },
    publishAgentsConfig(agents, clientVersion = Date.now()) {
      const payload: AgentsPublishClientMessage = {
        type: 'agents_publish',
        agents,
        clientVersion,
      };
      send(payload);
    },
    sendActorMove(actorId, targetFace, commandId, terrainVersion) {
      send({
        type: 'actor_move',
        actorId,
        targetFace,
        commandId,
        terrainVersion,
      });
    },
  };
}
