export const clientScript = `const field = document.getElementById('field');
const statusEl = document.getElementById('status');
const sessionEl = document.getElementById('session');
let currentTyping = '';

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

let socket;
let playerId = null;
let players = [];
let sessionStart = null;
let sessionTimerId = null;
let app = null;
let emojiLayer = null;
let physicsEngine = null;
let physicsBoxes = [];
const typingPositions = new Map();

function updateStatus(message) {
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
  if (!sessionStart) {
    sessionEl.textContent = 'Session: --:--';
    return;
  }
  sessionEl.textContent = 'Session: ' + formatDuration(Date.now() - sessionStart);
}

async function initScene() {
  if (!window.PIXI || app) {
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
  app = appInstance;
  field.appendChild(appInstance.canvas ?? appInstance.view);

  emojiLayer = new PIXI.Container();
  emojiLayer.x = 24;
  emojiLayer.y = 24;
  app.stage.addChild(emojiLayer);

  setupPhysics();
  bindPhysicsTicker();
  //enableSpawnOnClick();

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
  if (!window.Matter || !app) {
    return;
  }
  const { Engine, Bodies, World } = Matter;
  const engine = Engine.create({
    gravity: { x: 0, y: 1 },
  });
  physicsEngine = engine;
  physicsBoxes = [];

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

function bindPhysicsTicker() {
  if (!app || !physicsEngine) {
    return;
  }
  app.ticker.add((ticker) => {
    Matter.Engine.update(physicsEngine, ticker.deltaMS);
    physicsBoxes.forEach(({ body, graphic }) => {
      graphic.x = body.position.x;
      graphic.y = body.position.y;
      graphic.rotation = body.angle;
    });
  });
}

function enableSpawnOnClick() {
  if (!app) {
    return;
  }
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (event) => {
    spawnBox(event.global.x, event.global.y);
  });
}

function spawnBox(x, y) {
  if (!physicsEngine || !app || !window.Matter || !window.PIXI) {
    return;
  }
  const size = 24 + Math.random() * 32;
  const { Bodies, Body, World } = Matter;
  const body = Bodies.rectangle(x, y, size, size, {
    restitution: 0.6,
    friction: 0.3,
    density: 0.002,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 12,
    y: (Math.random() - 0.5) * 12,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.4);
  World.add(physicsEngine.world, body);

  const graphic = new PIXI.Graphics();
  graphic.roundRect(-size / 2, -size / 2, size, size, Math.min(10, size / 3));
  graphic.fill({ color: 0x57b9ff, alpha: 0.9 });
  graphic.stroke({ width: 2, color: 0x0b0e12, alpha: 0.8 });
  graphic.x = x;
  graphic.y = y;
  app.stage.addChild(graphic);

  physicsBoxes.push({ body, graphic });
}

function spawnTextBox(text, color, emoji, spawnPosition) {
  if (!physicsEngine || !app || !window.Matter || !window.PIXI) {
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
  if (textSprite.anchor?.set) {
    textSprite.anchor.set(0.5);
  }

  const boxWidth = textSprite.width;
  const boxHeight = textSprite.height;
  const position = spawnPosition || { x: PHONE_WIDTH / 2, y: PHONE_HEIGHT / 4 };
  const x = position.x;
  const y = position.y;
  const { Bodies, Body, World } = Matter;
  const body = Bodies.rectangle(x, y, boxWidth, boxHeight, {
    restitution: 0.5,
    friction: 0.4,
    density: 0.0025,
  });
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 2.5,
    y: (Math.random() - 0.5) * 2.5,
  });
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);
  World.add(physicsEngine.world, body);

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
  app.stage.addChild(container);

  physicsBoxes.push({ body, graphic: container });
}

function renderPlayers() {
  if (!emojiLayer || !window.PIXI) {
    return;
  }
  emojiLayer.removeChildren();
  typingPositions.clear();
  players.forEach((player, index) => {
    const style = new PIXI.TextStyle({
      fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
      fontSize: 28,
      fill: player.color || '#f5f5f5',
    });
    const typingText = player.typing ? ' ' + player.typing : '';
    const text = new PIXI.Text((player.emoji || '🪧') + typingText, style);
    text.x = 0;
    text.y = index * 36;
    emojiLayer.addChild(text);
    typingPositions.set(player.id, {
      x: emojiLayer.x + text.x + text.width / 2,
      y: emojiLayer.y + text.y + text.height / 2,
    });
  });
}

function connect() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || 'lobby';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol + '://' + location.host + '/room/' + roomId;
  socket = new WebSocket(url);

  const connectTimeout = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      updateStatus('Unable to connect. Check the server and refresh.');
    }
  }, 4000);

  socket.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    updateStatus('Connected to room ' + roomId + '.');
    document.body.classList.add('connected');
    socket.send(JSON.stringify({ type: 'join' }));
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'welcome') {
      playerId = payload.id;
    }
    if (payload.type === 'state') {
      players = payload.players || [];
      sessionStart = typeof payload.sessionStart === 'number' ? payload.sessionStart : null;
      renderPlayers();
      updateSessionTimer();
    }
    if (payload.type === 'launch') {
      spawnTextBox(payload.text || '', payload.color, payload.emoji, typingPositions.get(payload.id));
    }
  });

  socket.addEventListener('error', () => {
    updateStatus('Connection error. Refresh to retry.');
  });

  socket.addEventListener('close', () => {
    updateStatus('Disconnected. Refresh to reconnect.');
    document.body.classList.remove('connected');
  });
}

function sendTyping() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'typing',
      text: currentTyping,
    })
  );
}

function sendLaunch(text) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'launch',
      text,
    })
  );
}

void initScene();
connect();
if (!sessionTimerId) {
  sessionTimerId = setInterval(updateSessionTimer, 1000);
}
updateSessionTimer();

function handleKeyDown(event) {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === 'Backspace') {
    currentTyping = currentTyping.slice(0, -1);
    sendTyping();
    return;
  }
  if (event.key === 'Escape' || event.key === 'Enter') {
    if (event.key === 'Enter' && currentTyping.trim()) {
      sendLaunch(currentTyping);
    }
    currentTyping = '';
    sendTyping();
    return;
  }
  if (event.key.length === 1) {
    currentTyping += event.key;
    sendTyping();
  }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('blur', () => {
  // Intentionally keep currentTyping when the tab loses focus.
});
`;
