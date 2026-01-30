export const clientScript = `const field = document.getElementById('field');
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const roomInput = document.getElementById('room');
const hostBtn = document.getElementById('host');
const joinBtn = document.getElementById('join');
const leaveBtn = document.getElementById('leave');
const shareLinkInput = document.getElementById('share-link');
const copyBtn = document.getElementById('copy');
const messageInput = document.getElementById('message-input');

let socket;
let playerId = null;
const players = new Map();
const bodies = new Map();
const emojis = ['🐙', '🐳', '🦊', '🦄', '🐢', '🐸', '🐧', '🦋', '🐝', '🐬', '🦜', '🦉'];
let serverTimeOffset = 0;
const gravity = 1600;
const restitution = 0.35;
const popDuration = 0.2;
let animationFrame = null;
let canvasWidth = 0;
let canvasHeight = 0;
let deviceScale = 1;

function updateShareLink() {
  const room = roomInput.value.trim();
  if (!room) {
    shareLinkInput.value = '';
    return;
  }
  const params = new URLSearchParams();
  params.set('room', room);
  shareLinkInput.value = location.origin + '/?' + params.toString();
}

function updateStatus(message) {
  statusEl.textContent = message;
}

function syncMessageInput() {
  if (!messageInput || !playerId) {
    return;
  }
  const me = players.get(playerId);
  if (!me) {
    return;
  }
  if (document.activeElement !== messageInput) {
    messageInput.value = me.text || '';
  }
}

function resizeCanvas() {
  const rect = field.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(rect.width));
  const nextHeight = Math.max(1, Math.floor(rect.height));
  const nextScale = window.devicePixelRatio || 1;
  if (nextWidth === canvasWidth && nextHeight === canvasHeight && nextScale === deviceScale) {
    return;
  }
  canvasWidth = nextWidth;
  canvasHeight = nextHeight;
  deviceScale = nextScale;
  canvas.width = Math.floor(canvasWidth * deviceScale);
  canvas.height = Math.floor(canvasHeight * deviceScale);
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function getBubbleMetrics(text, font, paddingX, paddingY, minWidth) {
  ctx.font = font;
  const content = text && text.length > 0 ? text : ' ';
  const metrics = ctx.measureText(content);
  const textWidth = metrics.width;
  const height = Math.max(20, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + paddingY * 2);
  const width = Math.max(minWidth, textWidth + paddingX * 2);
  return { width, height, textWidth };
}

function drawBubbleAt({ left, centerY, text, font, paddingX, paddingY, minWidth, textColor }) {
  const metrics = getBubbleMetrics(text, font, paddingX, paddingY, minWidth);
  const top = centerY - metrics.height / 2;
  ctx.fillStyle = '#ffffff';
  roundedRectPath(ctx, left, top, metrics.width, metrics.height, metrics.height / 2);
  ctx.fill();
  if (text && text.length > 0) {
    ctx.font = font;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + paddingX, centerY + 0.5);
  }
  return metrics;
}

function drawCenteredBubble({ x, y, text, color, font, paddingX, paddingY, minWidth, scale }) {
  const metrics = getBubbleMetrics(text, font, paddingX, paddingY, minWidth);
  const width = metrics.width * scale;
  const height = metrics.height * scale;
  const left = x - width / 2;
  const top = y - height / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  ctx.fillStyle = '#ffffff';
  roundedRectPath(ctx, left, top, width, height, height / 2);
  ctx.fill();
  if (text && text.length > 0) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }
  ctx.restore();
  return metrics;
}

function updateBodies(now) {
  const ground = canvasHeight - 16;
  const font = '14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const bodyList = Array.from(bodies.values());
  const metricsMap = new Map();
  for (const body of bodyList) {
    const last = body.updatedAt || body.createdAt || now;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    if (dt > 0) {
      body.vy += gravity * dt;
      body.y += body.vy * dt;
      body.x += (body.vx || 0) * dt;
      body.vx *= 0.98;
      body.updatedAt = now;
    }
    const metrics = getBubbleMetrics(body.text, font, 14, 6, 32);
    metricsMap.set(body.id, metrics);
    const halfHeight = metrics.height / 2;
    if (body.y + halfHeight >= ground) {
      body.y = ground - halfHeight;
      if (body.vy > 0) {
        body.vy = -body.vy * restitution;
        if (Math.abs(body.vy) < 40) {
          body.vy = 0;
        }
      }
    }
    const halfWidth = metrics.width / 2;
    if (body.x - halfWidth < 8) {
      body.x = halfWidth + 8;
      body.vx = Math.abs(body.vx || 0);
    } else if (body.x + halfWidth > canvasWidth - 8) {
      body.x = canvasWidth - halfWidth - 8;
      body.vx = -Math.abs(body.vx || 0);
    }
  }

  for (let i = 0; i < bodyList.length; i += 1) {
    const bodyA = bodyList[i];
    const metricsA = metricsMap.get(bodyA.id);
    if (!metricsA) {
      continue;
    }
    const radiusA = Math.max(metricsA.width, metricsA.height) / 2;
    for (let j = i + 1; j < bodyList.length; j += 1) {
      const bodyB = bodyList[j];
      const metricsB = metricsMap.get(bodyB.id);
      if (!metricsB) {
        continue;
      }
      const radiusB = Math.max(metricsB.width, metricsB.height) / 2;
      const dx = bodyB.x - bodyA.x;
      const dy = bodyB.y - bodyA.y;
      const minDist = radiusA + radiusB;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) / 2;
        bodyA.x -= nx * overlap;
        bodyA.y -= ny * overlap;
        bodyB.x += nx * overlap;
        bodyB.y += ny * overlap;
        const relVx = (bodyB.vx || 0) - (bodyA.vx || 0);
        const relVy = (bodyB.vy || 0) - (bodyA.vy || 0);
        const relVel = relVx * nx + relVy * ny;
        if (relVel < 0) {
          const impulse = -(1 + restitution) * relVel * 0.5;
          bodyA.vx -= impulse * nx;
          bodyA.vy -= impulse * ny;
          bodyB.vx += impulse * nx;
          bodyB.vy += impulse * ny;
        }
      }
    }
  }
}

function renderFrame() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const now = Date.now() + serverTimeOffset;

  updateBodies(now);

  for (const body of bodies.values()) {
    const age = Math.max(0, (now - body.createdAt) / 1000);
    const pop = age < popDuration ? Math.sin((age / popDuration) * Math.PI) * 0.15 : 0;
    const scale = 1 + pop;
    drawCenteredBubble({
      x: body.x,
      y: body.y,
      text: body.text,
      color: body.color,
      font: '14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      paddingX: 14,
      paddingY: 6,
      minWidth: 32,
      scale,
    });
  }

  for (const player of players.values()) {
    const emojiSize = 28;
    ctx.font = emojiSize + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.emoji || emojis[0], player.x, player.y);

    ctx.font = '20px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const colonX = player.x + emojiSize * 0.6;
    ctx.fillText(':', colonX, player.y + 1);

    const bubbleLeft = colonX + 10;
    drawBubbleAt({
      left: bubbleLeft,
      centerY: player.y,
      text: player.text || '',
      font: '13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      paddingX: 10,
      paddingY: 5,
      minWidth: 16,
      textColor: player.color,
    });
  }
  animationFrame = requestAnimationFrame(renderFrame);
}

function ensureAnimation() {
  if (animationFrame !== null) {
    return;
  }
  animationFrame = requestAnimationFrame(renderFrame);
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function connect({ host }) {
  if (!roomInput.value.trim()) {
    roomInput.value = crypto.randomUUID().slice(0, 6);
  }
  updateShareLink();
  const roomId = roomInput.value.trim();
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = protocol + '://' + location.host + '/room/' + roomId + (host ? '?host=1' : '');
  socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    updateStatus('Connected to ' + roomId);
    document.body.classList.add('connected');
    leaveBtn.disabled = false;
    hostBtn.disabled = true;
    joinBtn.disabled = true;
    messageInput.disabled = false;
    messageInput.focus({ preventScroll: true });
    send({ type: 'join' });
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'welcome') {
      playerId = payload.id;
    }
    if (payload.type === 'state') {
      serverTimeOffset = payload.serverTime - Date.now();
      players.clear();
      for (const player of payload.players) {
        players.set(player.id, player);
      }
      for (const message of payload.messages || []) {
        if (!bodies.has(message.id)) {
          const now = Date.now() + serverTimeOffset;
          if (typeof message.vy !== 'number') {
            message.vy = 0;
          }
          if (typeof message.vx !== 'number') {
            message.vx = 0;
          }
          if (typeof message.createdAt !== 'number') {
            message.createdAt = now;
          }
          if (typeof message.updatedAt !== 'number') {
            message.updatedAt = message.createdAt;
          }
          bodies.set(message.id, message);
        }
      }
      syncMessageInput();
      ensureAnimation();
    }
    if (payload.type === 'error') {
      updateStatus(payload.message);
    }
  });

  socket.addEventListener('close', () => {
    updateStatus('Disconnected');
    document.body.classList.remove('connected');
    leaveBtn.disabled = true;
    hostBtn.disabled = false;
    joinBtn.disabled = false;
    messageInput.disabled = true;
    messageInput.value = '';
    players.clear();
    bodies.clear();
    syncMessageInput();
    ensureAnimation();
  });
}

hostBtn.addEventListener('click', () => connect({ host: true }));
joinBtn.addEventListener('click', () => connect({ host: false }));
leaveBtn.addEventListener('click', () => {
  socket?.close();
});
copyBtn.addEventListener('click', async () => {
  if (!shareLinkInput.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    updateStatus('Link copied to clipboard.');
  } catch (error) {
    updateStatus('Copy failed. Select the link and copy manually.');
  }
});

roomInput.addEventListener('input', () => {
  updateShareLink();
});

messageInput.addEventListener('input', () => {
  if (!playerId) {
    return;
  }
  send({ type: 'text', text: messageInput.value });
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const text = messageInput.value.trim();
  if (text.length > 0) {
    send({ type: 'drop', text });
  }
  messageInput.value = '';
  send({ type: 'text', text: '' });
});

let lastSent = 0;
field.addEventListener('pointermove', (event) => {
  const now = performance.now();
  if (now - lastSent < 40) return;
  lastSent = now;
  const rect = field.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  send({ type: 'move', x, y });
});

window.addEventListener('resize', () => {
  resizeCanvas();
  if (playerId && players.has(playerId)) {
    const me = players.get(playerId);
    send({ type: 'move', x: me.x, y: me.y });
  }
});

const params = new URLSearchParams(location.search);
if (params.has('room')) {
  roomInput.value = params.get('room') || '';
}
updateShareLink();

if (roomInput.value.trim()) {
  connect({ host: false });
}
ensureAnimation();`;
