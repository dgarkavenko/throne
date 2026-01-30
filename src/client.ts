export const clientScript = `const field = document.getElementById('field');
const statusEl = document.getElementById('status');

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

function initScene() {
  if (!window.PIXI || app) {
    return;
  }
  app = new PIXI.Application({
    width: PHONE_WIDTH,
    height: PHONE_HEIGHT,
    background: '#0b0e12',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  field.appendChild(app.view);

  emojiLayer = new PIXI.Container();
  emojiLayer.x = 24;
  emojiLayer.y = 24;
  app.stage.addChild(emojiLayer);

  renderPlayers();
}

function renderPlayers() {
  if (!emojiLayer) {
    return;
  }
  emojiLayer.removeChildren();
  const style = new PIXI.TextStyle({
    fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    fontSize: 28,
  });
  players.forEach((player, index) => {
    const text = new PIXI.Text(player.emoji || '🪧', style);
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

  socket.addEventListener('open', () => {
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

  socket.addEventListener('close', () => {
    updateStatus('Disconnected. Refresh to reconnect.');
    document.body.classList.remove('connected');
  });
}

initScene();
connect();
`;
