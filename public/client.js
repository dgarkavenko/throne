const field = document.getElementById('field');
const statusEl = document.getElementById('status');
const sessionEl = document.getElementById('session');
const fpsEl = document.getElementById('fps');

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const COLLIDER_SCALE = 0.9;

const state = {
  socket: null,
  playerId: null,
  players: [],
  currentTyping: '',
  sessionStart: null,
  sessionTimerId: null,
  typingPositions: new Map(),
};

const fpsTracker = {
  lastSample: performance.now(),
  frames: 0,
};

const game = {
  app: null,
  engine: null,
  layers: {
    world: null,
    ui: null,
  },
  entities: new Set(),
  addEntity(entity) {
    this.entities.add(entity);
    if (entity.onAdd) {
      entity.onAdd(this);
    }
  },
  removeEntity(entity) {
    if (entity.destroy) {
      entity.destroy(this);
    }
    this.entities.delete(entity);
  },
  update(deltaMs) {
    this.entities.forEach((entity) => {
      if (entity.update) {
        entity.update(deltaMs, this);
      }
    });
  },
};

function updateStatus(message) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, '0');
  return minutes + ':' + paddedSeconds;
}

function updateSessionTimer() {
  if (!sessionEl) {
    return;
  }
  if (!state.sessionStart) {
    sessionEl.textContent = 'Session: --:--';
    return;
  }
  sessionEl.textContent = formatDuration(Date.now() - state.sessionStart);
}

function updateFpsCounter(now) {
  if (!fpsEl) {
    return;
  }
  fpsTracker.frames += 1;
  const elapsed = now - fpsTracker.lastSample;
  if (elapsed < 500) {
    return;
  }
  const fps = Math.round((fpsTracker.frames * 1000) / elapsed);
  fpsEl.textContent = 'FPS: ' + fps;
  fpsTracker.frames = 0;
  fpsTracker.lastSample = now;
}

async function initScene() {
  if (!window.PIXI || game.app) {
    return;
  }
  const appInstance = new PIXI.Application();
  await appInstance.init({
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    background: 0x0b0e12,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  game.app = appInstance;
  if (field) {
    field.appendChild(appInstance.canvas ?? appInstance.view);
  }

  const worldLayer = new PIXI.Container();
  const uiLayer = new PIXI.Container();
  uiLayer.x = 24;
  uiLayer.y = 24;
  appInstance.stage.addChild(worldLayer);
  appInstance.stage.addChild(uiLayer);
  game.layers.world = worldLayer;
  game.layers.ui = uiLayer;

  setupPhysics();
  bindMainLoop();
  // enableSpawnOnClick();

  renderPlayers();
}

function parseColor(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.replace('#', '');
  const parsed = Number.parseInt(normalized, 16);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function setupPhysics() {
  if (!window.Matter || !game.app) {
    return;
  }
  const { Engine, Bodies, World } = Matter;
  const engine = Engine.create({
    gravity: { x: 0, y: 1 },
  });
  game.engine = engine;

  const wallThickness = 120;
  const boundaries = [
    Bodies.rectangle(PHONE_WIDTH / 2, PHONE_HEIGHT + wallThickness / 2, PHONE_WIDTH + wallThickness * 2, wallThickness, {
      isStatic: true,
    }),
    Bodies.rectangle(PHONE_WIDTH / 2, -wallThickness / 2, PHONE_WIDTH + wallThickness * 2, wallThickness, {
      isStatic: true,
    }),
    Bodies.rectangle(-wallThickness / 2, PHONE_HEIGHT / 2, wallThickness, PHONE_HEIGHT + wallThickness * 2, {
      isStatic: true,
    }),
    Bodies.rectangle(PHONE_WIDTH + wallThickness / 2, PHONE_HEIGHT / 2, wallThickness, PHONE_HEIGHT + wallThickness * 2, {
      isStatic: true,
    }),
  ];
  World.add(engine.world, boundaries);
}

function bindMainLoop() {
  if (!game.app || !game.engine) {
    return;
  }
  game.app.ticker.add((ticker) => {
    Matter.Engine.update(game.engine, ticker.deltaMS);
    game.update(ticker.deltaMS);
    updateFpsCounter(performance.now());
  });
}

function enableSpawnOnClick() {
  if (!game.app) {
    return;
  }
  game.app.stage.eventMode = 'static';
  game.app.stage.hitArea = game.app.screen;
  game.app.stage.on('pointerdown', (event) => {
    spawnBox(event.global.x, event.global.y);
  });
}

function createPhysicsEntity(body, display) {
  if (!game.engine || !game.layers.world) {
    return null;
  }
  Matter.World.add(game.engine.world, body);
  game.layers.world.addChild(display);
  const entity = {
    body,
    display,
    update() {
      display.x = body.position.x;
      display.y = body.position.y;
      display.rotation = body.angle;
    },
    destroy(currentGame) {
      if (currentGame.engine) {
        Matter.World.remove(currentGame.engine.world, body);
      }
      if (display.removeFromParent) {
        display.removeFromParent();
      }
    },
  };
  game.addEntity(entity);
  return entity;
}

function spawnBox(x, y) {
  if (!game.engine || !game.app || !window.Matter || !window.PIXI) {
    return;
  }
  const size = 24 + Math.random() * 32;
  const { Bodies, Body } = Matter;
  const colliderSize = size * COLLIDER_SCALE;
  const body = Bodies.rectangle(x, y, colliderSize, colliderSize, {
    restitution: 0.6,
    friction: 0.3,
    density: 0.002,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 12,
    y: (Math.random() - 0.5) * 12,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);

  const graphic = new PIXI.Graphics();
  graphic.roundRect(-size / 2, -size / 2, size, size, Math.min(10, size / 3));
  graphic.fill({ color: 0x57b9ff, alpha: 0.9 });
  graphic.stroke({ width: 2, color: 0x0b0e12, alpha: 0.8 });
  graphic.x = x;
  graphic.y = y;

  createPhysicsEntity(body, graphic);
}

function spawnTextBox(text, color, emoji, spawnPosition) {
  if (!game.engine || !game.app || !window.Matter || !window.PIXI) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const style = new PIXI.TextStyle({
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    fontSize: 28,
    fill: color || '#f5f5f5',
    fontWeight: '600',
    wordWrap: true,
    wordWrapWidth: PHONE_WIDTH - 80,
  });
  const textSprite = new PIXI.Text(trimmed, style);
  if (textSprite.anchor && textSprite.anchor.set) {
    textSprite.anchor.set(0.5);
  }

  const boxWidth = textSprite.width;
  const boxHeight = textSprite.height;
  const position = spawnPosition || { x: PHONE_WIDTH / 2, y: PHONE_HEIGHT / 4 };
  const x = position.x;
  const y = position.y;
  const { Bodies, Body } = Matter;
  const body = Bodies.rectangle(x, y, boxWidth * COLLIDER_SCALE, boxHeight * COLLIDER_SCALE, {
    restitution: 0.5,
    friction: 0.4,
    density: 0.0025,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 2.5,
    y: (Math.random() - 0.5) * 2.5,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);

  const container = new PIXI.Container();
  const background = new PIXI.Graphics();
  background.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  background.fill({ color: 0x0b0e12, alpha: 1 });
  container.addChild(background);
  textSprite.x = 0;
  textSprite.y = 0;
  container.addChild(textSprite);
  container.x = x;
  container.y = y;

  createPhysicsEntity(body, container);
}

function getHistorySpawnPosition(index, total) {
  const clampedTotal = Math.max(1, total);
  const lowerBound = PHONE_HEIGHT - 140;
  const upperBound = 140;
  const progress = clampedTotal === 1 ? 0 : index / (clampedTotal - 1);
  const y = lowerBound - progress * (lowerBound - upperBound);
  const jitter = 24;
  return {
    x: PHONE_WIDTH / 2 + (Math.random() - 0.5) * jitter,
    y: y + (Math.random() - 0.5) * jitter,
  };
}

function renderPlayers() {
  if (!game.layers.ui || !window.PIXI) {
    return;
  }
  const uiLayer = game.layers.ui;
  uiLayer.removeChildren();
  state.typingPositions.clear();
  state.players.forEach((player, index) => {
    const style = new PIXI.TextStyle({
      fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      fontSize: 28,
      fill: player.color || '#f5f5f5',
    });
    const avatar = (player.emoji || '\ud83e\udea7') + ':';
    const typingText = player.typing ? ' ' + player.typing : '';
    const row = new PIXI.Container();
    const avatarText = new PIXI.Text(avatar, style);
    const typingSprite = new PIXI.Text(typingText, style);
    typingSprite.x = avatarText.width;
    row.addChild(avatarText);
    row.addChild(typingSprite);
    row.x = 0;
    row.y = index * 36;
    uiLayer.addChild(row);
    state.typingPositions.set(player.id, {
      x: uiLayer.x + row.x + avatarText.width + typingSprite.width / 2,
      y: uiLayer.y + row.y + avatarText.height / 2,
    });
  });
}

function connect() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'lobby';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol + '://' + location.host + '/room/' + roomId;
  state.socket = new WebSocket(url);

  const connectTimeout = setTimeout(() => {
    if (state.socket && state.socket.readyState !== WebSocket.OPEN) {
      updateStatus('Unable to connect. Check the server and refresh.');
    }
  }, 4000);

  state.socket.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    updateStatus('Connected to room ' + roomId + '.');
    document.body.classList.add('connected');
    if (state.socket) {
      state.socket.send(JSON.stringify({ type: 'join' }));
    }
  });

  state.socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'welcome') {
      state.playerId = payload.id;
    }
    if (payload.type === 'state') {
      state.players = payload.players || [];
      state.sessionStart = typeof payload.sessionStart === 'number' ? payload.sessionStart : null;
      renderPlayers();
      updateSessionTimer();
    }
    if (payload.type === 'history' && Array.isArray(payload.messages)) {
      const totalMessages = payload.messages.length;
      payload.messages.forEach((message, index) => {
        if (!message || typeof message.text !== 'string') {
          return;
        }
        const spawnPosition = getHistorySpawnPosition(index, totalMessages);
        spawnTextBox(message.text, message.color, message.emoji, spawnPosition);
      });
    }
    if (payload.type === 'launch') {
      spawnTextBox(payload.text || '', payload.color, payload.emoji, state.typingPositions.get(payload.id));
    }
  });

  state.socket.addEventListener('error', () => {
    updateStatus('Connection error. Refresh to retry.');
  });

  state.socket.addEventListener('close', () => {
    updateStatus('Disconnected. Refresh to reconnect.');
    document.body.classList.remove('connected');
  });
}

function sendTyping() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: 'typing',
      text: state.currentTyping,
    })
  );
}

function sendLaunch(text) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(
    JSON.stringify({
      type: 'launch',
      text,
    })
  );
}

void initScene();
connect();
if (!state.sessionTimerId) {
  state.sessionTimerId = setInterval(updateSessionTimer, 1000);
}
updateSessionTimer();

function handleKeyDown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === 'Backspace') {
    state.currentTyping = state.currentTyping.slice(0, -1);
    sendTyping();
    return;
  }
  if (event.key === 'Escape' || event.key === 'Enter') {
    if (event.key === 'Enter' && state.currentTyping.trim()) {
      sendLaunch(state.currentTyping);
    }
    state.currentTyping = '';
    sendTyping();
    return;
  }
  if (event.key.length === 1) {
    state.currentTyping += event.key;
    sendTyping();
  }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('blur', () => {
  // Intentionally keep currentTyping when the tab loses focus.
});
