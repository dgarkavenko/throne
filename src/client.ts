export const clientScript = `const field = document.getElementById('field');
const statusEl = document.getElementById('status');
let currentTyping = '';

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

let socket;
let playerId = null;
let players = [];
let app = null;
let emojiLayer = null;
let physicsEngine = null;
let physicsBoxes = [];

function updateStatus(message) {
  statusEl.textContent = message;
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

function renderPlayers() {
  if (!emojiLayer || !window.PIXI) {
    return;
  }
  emojiLayer.removeChildren();
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
      renderPlayers();
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

void initScene();
connect();

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
  if (currentTyping) {
    currentTyping = '';
    sendTyping();
  }
});
`;
