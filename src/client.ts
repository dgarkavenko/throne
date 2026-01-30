export const clientScript = `const field = document.getElementById('field');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

let socket;
let playerId = null;
let players = [];
let app = null;
let emojiLayer = null;
const logMessages = [];

function updateStatus(message) {
  statusEl.textContent = message;
}

function addLog(message) {
  if (!logEl) {
    return;
  }
  logMessages.push({ message, time: new Date() });
  if (logMessages.length > 30) {
    logMessages.shift();
  }
  renderLog();
}

function renderLog() {
  logEl.innerHTML = '';
  logMessages.forEach((entry) => {
    const item = document.createElement('li');
    const time = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.textContent = '[' + time + '] ' + entry.message;
    logEl.appendChild(item);
  });
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
  if (!emojiLayer || !window.PIXI) {
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

  const connectTimeout = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      updateStatus('Unable to connect. Check the server and refresh.');
    }
  }, 4000);

  socket.addEventListener('open', () => {
    clearTimeout(connectTimeout);
    updateStatus('Connected to room ' + roomId + '.');
    document.body.classList.add('connected');
    addLog('Connected to room ' + roomId + '.');
    socket.send(JSON.stringify({ type: 'join' }));
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'welcome') {
      playerId = payload.id;
      addLog('Welcome! Your id is ' + payload.id + '.');
    }
    if (payload.type === 'state') {
      players = payload.players || [];
      renderPlayers();
      addLog('State updated: ' + players.length + ' player(s) connected.');
    }
  });

  socket.addEventListener('error', () => {
    updateStatus('Connection error. Refresh to retry.');
  });

  socket.addEventListener('close', () => {
    updateStatus('Disconnected. Refresh to reconnect.');
    document.body.classList.remove('connected');
    addLog('Disconnected from room ' + roomId + '.');
  });
}

initScene();
connect();
`;
