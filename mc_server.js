// mc_server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const session = require('express-session');
require('dotenv').config();   // loads .env into process.env

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== Canvas / grid settings =====
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const TILE_SIZE = 10;                       // smaller tiles → more space
const GRID_COLS = CANVAS_WIDTH / TILE_SIZE; // 80
const GRID_ROWS = CANVAS_HEIGHT / TILE_SIZE;// 60

// tiles[row][col] = { ownerId, color } or null
let tiles = [];
function resetTiles() {
  tiles = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) {
      row.push(null);
    }
    tiles.push(row);
  }
}
resetTiles();

// ===== Players =====
// players[id] = { id, name, x, y, color }
const players = {};

const COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#4cd964',
  '#5ac8fa', '#007aff', '#5856d6', '#ff2d55',
  '#00c7be', '#ff9f0a', '#34c759', '#af52de'
];

function getRandomColor(usedColors) {
  // usedColors is an array of colors already taken
  const available = COLORS.filter(c => !usedColors.includes(c));
  if (available.length === 0) {
    // fallback if somehow all colors are used
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function paintTileForPlayer(player) {
  const col = Math.floor(player.x / TILE_SIZE);
  const row = Math.floor(player.y / TILE_SIZE);
  if (
    row >= 0 && row < GRID_ROWS &&
    col >= 0 && col < GRID_COLS
  ) {
    tiles[row][col] = { ownerId: player.id, color: player.color };
    return { row, col };
  }
  return null;
}

// ===== Express middleware =====
app.use(express.urlencoded({ extended: true })); // needed for POST form
app.use(express.static(path.join(__dirname, 'public')));

// ===== Socket.IO real-time logic =====
io.on('connection', (socket) => {
  console.log('New socket connection');
  const { token } = socket.handshake.auth || {};

  if (!token || token === '_') {
    console.log('Invalid or missing token, disconnecting socket');
    socket.disconnect(true);
    return;
  }

  // Create player
  const id = uuidv4();
  const usedColors = Object.values(players).map(p => p.color);
  const color = getRandomColor(usedColors);

  const startX = Math.floor(Math.random() * CANVAS_WIDTH);
  const startY = Math.floor(Math.random() * CANVAS_HEIGHT);

  players[id] = {
    id,
    name: token,
    x: startX,
    y: startY,
    color
  };

  // Paint starting tile
  const startTile = paintTileForPlayer(players[id]);

  console.log(`Player joined: ${token} (${id}) at (${startX}, ${startY})`);

  // Send initial state (full snapshot) to THIS client only
  socket.emit('init', {
    id,
    players,
    tiles
  });

  // Notify others a new player joined
  socket.broadcast.emit('playerJoin', players[id]);

  // Handle movement (delta updates)
  socket.on('move', ({ dx, dy }) => {
    const player = players[id];
    if (!player) return;

    const speed = 4; // 🔹 slower than before (was 10)

    player.x = clamp(player.x + dx * speed, 0, CANVAS_WIDTH - 1);
    player.y = clamp(player.y + dy * speed, 0, CANVAS_HEIGHT - 1);

    // Paint tile and get which tile changed
    const tilePos = paintTileForPlayer(player);

    // Broadcast just this player's move
    io.emit('playerMove', {
      id: player.id,
      x: player.x,
      y: player.y
    });

    // Broadcast the painted tile (delta)
    if (tilePos) {
      io.emit('paint', {
        row: tilePos.row,
        col: tilePos.col,
        ownerId: player.id,
        color: player.color
      });
    }
  });

  // Optional: respawn handler (you can call this from client later if you want)
  socket.on('respawn', () => {
    const player = players[id];
    if (!player) return;
    player.x = Math.floor(Math.random() * CANVAS_WIDTH);
    player.y = Math.floor(Math.random() * CANVAS_HEIGHT);
    const tilePos = paintTileForPlayer(player);

    io.emit('playerMove', {
      id: player.id,
      x: player.x,
      y: player.y
    });
    if (tilePos) {
      io.emit('paint', {
        row: tilePos.row,
        col: tilePos.col,
        ownerId: player.id,
        color: player.color
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${id}`);
    delete players[id];
    io.emit('playerLeave', id);
    // tiles remain painted – territory persists
  });
});

// ========= Authentication related =========
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 // 1 hour
    }
  })
);

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.redirect('/login');
}

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/canvas');
  }
  return res.redirect('/login');
});

// Login form
app.get('/login', (req, res) => {
  console.log('GET /login');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login handler
app.post('/login', (req, res) => {
  const { name, password } = req.body;
  console.log('POST /login', req.body);
  if (password === process.env.SHARED_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = name;
    return res.redirect('/canvas');
  }
  res.redirect('/login?error=1');
});

// Protected game page
app.get('/canvas', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'participate_game_93.html'));
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ===== Start server =====
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO server running at http://0.0.0.0:${PORT}`);
});

