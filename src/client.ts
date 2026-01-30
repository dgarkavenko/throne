export const clientScript = `const field = document.getElementById('field');
const statusEl = document.getElementById('status');
const typingField = document.getElementById('typing');

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

let socket;
let playerId = null;
let players = [];
let app = null;
let emojiLayer = null;

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

  renderPlayers();
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
      text: typingField?.value ?? '',
    })
  );
}

void initScene();
connect();

typingField?.addEventListener('input', sendTyping);
`;
