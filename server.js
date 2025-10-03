// --- 1. 引入所有必要的模块 ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// --- 2. 初始化服务器 ---
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const port = process.env.PORT || 3000;

// --- 上传文件和静态服务配置 ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = req.body.username + '-' + Date.now();
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- 用户数据处理 ---
const DB_PATH = path.join(__dirname, 'users.json');
let usersDB = {};

function loadUsers() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH);
            usersDB = JSON.parse(data);
            console.log('用户数据库加载成功！');
        } else {
            fs.writeFileSync(DB_PATH, JSON.stringify({}));
            console.log('未找到用户数据库，已创建新文件。');
        }
    } catch (err) {
        console.error('加载用户数据库时出错:', err);
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(usersDB, null, 2));
    } catch (err)
 {
        console.error('保存用户数据时出错:', err);
    }
}

loadUsers();

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- 路由 ---
app.post('/upload-background', upload.single('cardbg'), (req, res) => {
    const username = req.body.username;
    const user = usersDB[username];

    if (!user) {
        return res.status(404).json({ success: false, message: '用户不存在' });
    }
    if (!req.file) {
        return res.status(400).json({ success: false, message: '未上传文件' });
    }

    if (user.cardBackground) {
        const oldPath = path.join(__dirname, user.cardBackground);
        if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
        }
    }
    
    const filePath = '/uploads/' + req.file.filename;
    user.cardBackground = filePath;
    saveUsers();
    
    broadcastLeaderboardUpdate();

    res.json({ success: true, message: '上传成功!', filePath: filePath });
});


// --- 3. 游戏核心逻辑 ---
function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const DEFAULT_MAX_HEALTH = 10;
class Player {
    constructor(name, id, socketId, username, cardBackground, initialHealth = DEFAULT_MAX_HEALTH, initialHands = [1, 1]) {
        this.id = id;
        this.name = name;
        this.maxHealth = initialHealth;
        this.health = initialHealth;
        this.hands = initialHands;
        this.is_alive = true;
        this.strength_potion_active = false;
        this.sword_level = 1;
        this.usedCombos = new Set();
        this.socketId = socketId;
        this.username = username;
        this.cardBackground = cardBackground || null;
    }
    takeDamage(damage) {
        if (this.hands.includes(4)) { damage = Math.max(0, damage - 0.5); }
        if (damage < 0) damage = 0; this.health -= damage;
        if (this.health <= 0) { this.health = 0; this.is_alive = false; }
    }
    heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }
}

const rooms = {};
const turnTimers = {};
const onlineUsers = {};

function generateRoomId() {
    let result = ''; const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 4; i++) { result += characters.charAt(Math.floor(Math.random() * characters.length)); }
    return result;
}

function getLobbyInfo() {
    const lobbyRooms = [];
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (room.phase === 'waiting') {
            lobbyRooms.push({
                id: room.id,
                playersCount: room.players.length,
                maxPlayers: room.maxPlayers,
                hasPassword: !!room.password,
            });
        }
    }
    return lobbyRooms;
}

function broadcastLobbyUpdate() {
    io.emit('updateLobby', getLobbyInfo());
}

function broadcastLeaderboardUpdate() {
    const leaderboardData = Object.keys(usersDB).map(username => {
        const user = usersDB[username];
        const stats = user.stats || { wins: 0, gamesPlayed: 0 };
        const winRate = stats.gamesPlayed > 0 ? (stats.wins / stats.gamesPlayed) * 100 : 0;
        
        return {
            nickname: user.nickname,
            wins: stats.wins,
            gamesPlayed: stats.gamesPlayed,
            winRate: winRate,
            cardBackground: user.cardBackground,
            isOnline: !!onlineUsers[username]
        };
    });

    leaderboardData.sort((a, b) => {
        if (b.winRate !== a.winRate) {
            return b.winRate - a.winRate;
        }
        return b.wins - a.wins;
    });

    io.emit('updateLeaderboard', leaderboardData);
}

function calculateComboActions(player) {
    const combos = []; const h = player.hands; const has = (num) => h.includes(num);
    if (has(5) && has(4) && !player.usedCombos.has('combo_forge')) combos.push('combo_forge');
    if (h[0] === 8 && h[1] === 8 && !player.usedCombos.has('combo_strength')) combos.push('combo_strength');
    if (h[0] === 9 && h[1] === 9 && !player.usedCombos.has('combo_heal')) combos.push('combo_heal');
    if (has(7) && has(8) && !player.usedCombos.has('combo_extra_turn')) combos.push('combo_extra_turn');
    if (h[0] === 0 && h[1] === 0 && !player.usedCombos.has('combo_life_link')) combos.push('combo_life_link');
    if (has(0) && (has(1) || has(2)) && !player.usedCombos.has('combo_reset')) combos.push('combo_reset');
    if (has(0) && has(9) && !player.usedCombos.has('combo_resurrect')) combos.push('combo_resurrect');
    return combos;
}

function resetBrokenCombos(room, player) {
    const h = player.hands; const has = (num) => h.includes(num); const activeCombos = new Set();
    if (has(5) && has(4)) activeCombos.add('combo_forge');
    if (h[0] === 8 && h[1] === 8) activeCombos.add('combo_strength');
    if (h[0] === 9 && h[1] === 9) activeCombos.add('combo_heal');
    if (has(7) && has(8)) activeCombos.add('combo_extra_turn');
    if (h[0] === 0 && h[1] === 0) activeCombos.add('combo_life_link');
    if (has(0) && (has(1) || has(2))) activeCombos.add('combo_reset');
    if (has(0) && has(9)) activeCombos.add('combo_resurrect');

    for (const used of player.usedCombos) {
        if (!activeCombos.has(used)) {
            player.usedCombos.delete(used);
            room.log.unshift(`[系统] ${player.name} 的组合技 [${used.split('_')[1]}] 已被破坏，可以重新凑出。`);
        }
    }
}

function hasValidTargets(currentPlayer, players) {
    for (const player of players) {
        if (player.id !== currentPlayer.id && player.is_alive && (player.hands[0] !== 0 || player.hands[1] !== 0)) {
            return true;
        }
    }
    return false;
}

function advanceToNextTurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameOver) return;

    if (turnTimers[roomId]) {
        clearTimeout(turnTimers[roomId]);
        delete turnTimers[roomId];
    }

    let nextPlayerFound = false;
    let attempts = 0;

    while (!nextPlayerFound && attempts < room.players.length) {
        if (room.extraTurn) {
            room.extraTurn = false;
            room.log.unshift(`[系统] ${room.players[room.currentPlayerIndex].name} 开始了他的额外回合！`);
        } else {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
            while (!room.players[room.currentPlayerIndex].is_alive) {
                room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
            }
        }

        const nextPlayer = room.players[room.currentPlayerIndex];
        
        if (hasValidTargets(nextPlayer, room.players)) {
            nextPlayerFound = true;
            room.phase = 'addNumber';
            room.possibleActions = null;
        } else {
            room.log.unshift(`[系统] 玩家 ${nextPlayer.name} 没有任何有效的操作目标，回合被自动跳过！`);
            if(room.extraTurn) room.extraTurn = false;
        }
        attempts++;
    }

    if (!nextPlayerFound) {
        room.gameOver = true;
        room.winner = "平局 (僵持)";
        room.log.unshift(`[系统] 所有存活玩家都无法行动，游戏陷入僵局！`);
        io.to(roomId).emit('updateState', room);
        return;
    }

    const currentPlayerName = room.players[room.currentPlayerIndex].name;
    room.turnStartTime = Date.now();
    
    turnTimers[roomId] = setTimeout(() => {
        if (rooms[roomId] && !rooms[roomId].gameOver) {
            rooms[roomId].log.unshift(`[系统] 玩家 ${currentPlayerName} 操作超时，回合自动结束！`);
            advanceToNextTurn(roomId);
        }
    }, 40000);

    io.to(roomId).emit('updateState', room);
}


// --- 4. Socket.IO 核心连接逻辑 ---
io.on('connection', (socket) => {

    socket.emit('updateLobby', getLobbyInfo());
    broadcastLeaderboardUpdate();

    socket.on('register', ({ username, password, nickname }) => {
        if (usersDB[username]) {
            socket.emit('registerError', '用户名已存在！');
        } else {
            usersDB[username] = {
                password,
                nickname,
                stats: { wins: 0, gamesPlayed: 0 },
                cardBackground: null
            };
            saveUsers();
            socket.emit('registerSuccess', '注册成功！请登录。');
            broadcastLeaderboardUpdate();
        }
    });

    socket.on('login', ({ username, password }) => {
        const user = usersDB[username];
        if (!user) {
            socket.emit('loginError', '用户不存在！');
        } else if (user.password !== password) {
            socket.emit('loginError', '密码错误！');
        } else {
            onlineUsers[username] = socket.id;
            socket.username = username;

            socket.emit('loginSuccess', {
                username,
                nickname: user.nickname,
                stats: user.stats,
                cardBackground: user.cardBackground
            });
            
            broadcastLeaderboardUpdate(); 
        }
    });

    socket.on('createRoom', ({ playerName, maxPlayers, username, password, initialHealth, initialHands }) => {
        let roomId = generateRoomId();
        while(rooms[roomId]) { roomId = generateRoomId(); }
        socket.join(roomId);
        const user = usersDB[username];
        
        const creator = new Player(playerName, 0, socket.id, username, user.cardBackground, initialHealth, initialHands);

        rooms[roomId] = {
            id: roomId,
            players: [creator],
            log: [`[系统] 玩家 ${playerName} 创建了房间 ${roomId}`],
            phase: 'waiting', 
            maxPlayers: parseInt(maxPlayers),
            password: password || null,
            initialHealth: initialHealth,
            gameOver: false,
            extraTurn: false
        };
        socket.emit('roomCreated', { roomId, gameState: rooms[roomId], myPlayerId: 0 });
        broadcastLobbyUpdate();
    });

    socket.on('joinRoom', ({ roomId, playerName, username, password }) => {
        const room = rooms[roomId];
        if (!room) { return socket.emit('errorMsg', '房间不存在！'); }
        if (room.players.length >= room.maxPlayers) { return socket.emit('errorMsg', '房间已满！'); }
        if (room.phase !== 'waiting') { return socket.emit('errorMsg', '游戏已经开始，无法加入！'); }
        
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', '房间密码错误！');
        }

        socket.join(roomId);
        const user = usersDB[username];
        const newPlayer = new Player(playerName, room.players.length, socket.id, username, user.cardBackground, room.initialHealth, [1, 1]);
        room.players.push(newPlayer);
        room.log.unshift(`[系统] 玩家 ${playerName} 加入了房间！`);
        socket.emit('roomJoined', { roomId, gameState: room, myPlayerId: newPlayer.id });
        
        if (room.players.length === room.maxPlayers) {
            room.phase = 'addNumber'; room.currentPlayerIndex = -1;
            room.log.unshift("[系统] 所有玩家已到齐，游戏开始！");
            advanceToNextTurn(roomId);
        } else {
            io.to(roomId).emit('updateState', room);
        }
        
        broadcastLobbyUpdate();
    });

    socket.on('sendMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const sanitizedMessage = sanitizeString(message);
        if (sanitizedMessage.trim().length === 0 || sanitizedMessage.length > 200) {
            return;
        }
        
        const displayName = player.is_alive ? player.name : `${player.name} (幽灵)`;
        const logEntry = `${displayName}: ${sanitizedMessage}`;
        room.log.unshift(logEntry);

        io.to(roomId).emit('updateState', room);
    });

    socket.on('playerAction', (data) => {
        const { roomId, action, payload } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer.socketId !== socket.id) return;

        if (turnTimers[roomId]) {
            clearTimeout(turnTimers[roomId]);
            delete turnTimers[roomId];
        }

        if (action === 'addNumber') {
            const { attackerHandIndex, targetPlayerId, targetHandIndex } = payload;
            const targetPlayer = room.players.find(p => p.id === targetPlayerId);
            if (!targetPlayer || !targetPlayer.is_alive || targetPlayer.hands[targetHandIndex] === 0) {
                advanceToNextTurn(roomId); 
                return;
            }

            const sum = currentPlayer.hands[attackerHandIndex] + targetPlayer.hands[targetHandIndex];
            const newValue = sum % 10;
            currentPlayer.hands[attackerHandIndex] = newValue;
            room.log.unshift(`[系统] ${currentPlayer.name} 的手碰了 ${targetPlayer.name} 的手，变成了 [${newValue}]`);
            resetBrokenCombos(room, currentPlayer);
            room.oneTimeActions = [];
            const isTntTrigger = (sum > 0 && sum % 10 === 0);
            if (isTntTrigger) {
                room.log.unshift(`[系统] 和为 ${sum}，触发TNT！`);
                const otherAlivePlayers = room.players.filter(p => p.is_alive && p.id !== currentPlayer.id);
                if (otherAlivePlayers.length === 1) {
                    let tntDamage = 1.5;
                    otherAlivePlayers[0].takeDamage(tntDamage);
                    room.phase = 'action';
                } else { room.phase = 'resolveTntTarget'; }
            } else {
                if (newValue === 9) { currentPlayer.heal(1); room.log.unshift(`[系统] ${currentPlayer.name} 触发了药水，回复1血！`); }
                else if (newValue === 5) { room.oneTimeActions.push({ type: 'skill', action: 'attack_sword' }); }
                const hasArrows = currentPlayer.hands.includes(3) || currentPlayer.hands.includes(6);
                if (currentPlayer.hands.includes(7) && hasArrows) { if (!room.oneTimeActions.some(a => a.action === 'attack_bow')) room.oneTimeActions.push({ type: 'skill', action: 'attack_bow' }); }
                if (currentPlayer.hands.includes(8) && hasArrows) { if (!room.oneTimeActions.some(a => a.action === 'attack_crossbow')) room.oneTimeActions.push({ type: 'skill', action: 'attack_crossbow' }); }
                room.phase = 'action';
            }
            if(room.phase === 'action') { room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(currentPlayer) }; }
        }
        else if(action === 'resolveTnt') {
            const { targetId } = payload;
            const targetPlayer = room.players.find(p => p.id === targetId);
            let tntDamage = 1.5;
            if (currentPlayer.strength_potion_active) { tntDamage *= 2; currentPlayer.strength_potion_active = false; }
            targetPlayer.takeDamage(tntDamage);
            room.phase = 'action';
            room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(currentPlayer) };
        }
        else if (action === 'useAction') {
            const { type, action: skillAction, targetId } = payload;
            let targetPlayer = room.players.find(p => p.id === targetId);
            if(type === 'skill') {
                room.oneTimeActions = room.oneTimeActions.filter(a => a.action !== skillAction);
                let damage = 0; let actionText = '';
                switch(skillAction) {
                    case 'attack_bow': damage = 1; actionText = '用弓射出了一箭'; const arrowHandIndex_bow = currentPlayer.hands.indexOf(3) !== -1 ? currentPlayer.hands.indexOf(3) : currentPlayer.hands.indexOf(6); currentPlayer.hands[arrowHandIndex_bow] = 1; break;
                    case 'attack_crossbow': damage = currentPlayer.hands.includes(6) ? 2 : 1; actionText = '用弩射出了' + (damage) + '支箭'; const arrowHandIndex_cross = currentPlayer.hands.indexOf(3) !== -1 ? currentPlayer.hands.indexOf(3) : currentPlayer.hands.indexOf(6); currentPlayer.hands[arrowHandIndex_cross] = 1; break;
                    case 'attack_sword': damage = 0.5 + (currentPlayer.sword_level - 1) * 0.5; actionText = `用 ${currentPlayer.sword_level}级 剑砍了一刀`; break;
                }
                if (currentPlayer.strength_potion_active) { damage *= 2; currentPlayer.strength_potion_active = false; }
                room.log.unshift(`[系统] ${currentPlayer.name} ${actionText}`); targetPlayer.takeDamage(damage);
            }
            if(type === 'combo') {
                currentPlayer.usedCombos.add(skillAction);
                switch(skillAction) {
                    case 'combo_forge': currentPlayer.sword_level++; room.log.unshift(`[系统] ${currentPlayer.name} 使用了锻造，剑升到了 ${currentPlayer.sword_level} 级！`); break;
                    case 'combo_strength': currentPlayer.strength_potion_active = true; room.log.unshift(`[系统] ${currentPlayer.name} 激活了力量药水！`); break;
                    case 'combo_heal': currentPlayer.heal(2); room.log.unshift(`[系统] ${currentPlayer.name} 回复了2点生命！`); break;
                    case 'combo_extra_turn': room.extraTurn = true; room.log.unshift(`[系统] ${currentPlayer.name} 获得了额外回合！`); break;
                    case 'combo_life_link': const total_health = currentPlayer.health + targetPlayer.health; currentPlayer.health = Math.floor(total_health / 2); targetPlayer.health = Math.ceil(total_health / 2); room.log.unshift(`[系统] ${currentPlayer.name} 与 ${targetPlayer.name} 平均了血量！`); break;
                    case 'combo_reset': const handToReset = targetPlayer.hands[0] > targetPlayer.hands[1] ? 0 : 1; targetPlayer.hands[handToReset] = 1; room.log.unshift(`[系统] ${currentPlayer.name} 重置了 ${targetPlayer.name} 的一只手！`); break;
                    case 'combo_resurrect':
                        if (targetPlayer && !targetPlayer.is_alive) {
                            targetPlayer.is_alive = true;
                            targetPlayer.health = Math.ceil(targetPlayer.maxHealth / 2);
                            room.log.unshift(`[系统] 神迹发生！${currentPlayer.name} 使用复活将 ${targetPlayer.name} 带回了战场！`);
                        }
                        break;
                }
            }
            // +++ 修复核心：在使用技能后，不要结束回合，而是重新计算并更新可用技能列表 +++
            room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(currentPlayer) };
        }
        else if(action === 'endTurn') {
            room.oneTimeActions = [];
            advanceToNextTurn(roomId);
            return; // 结束回合后必须 return，防止后续代码执行
        }

        // 每次操作后，都检查游戏是否结束
        const alivePlayers = room.players.filter(p => p.is_alive);
        if (alivePlayers.length <= 1) {
            if (turnTimers[roomId]) {
                clearTimeout(turnTimers[roomId]);
                delete turnTimers[roomId];
            }
            room.gameOver = true;
            room.winner = alivePlayers.length === 1 ? alivePlayers[0].name : "没有胜利者";
            room.log.unshift(`[系统] 游戏结束！胜利者是 ${room.winner}！`);
            const winnerPlayer = alivePlayers.length === 1 ? alivePlayers[0] : null;
            room.players.forEach(p => {
                if(usersDB[p.username]) {
                    usersDB[p.username].stats.gamesPlayed++;
                    if(winnerPlayer && p.username === winnerPlayer.username) {
                        usersDB[p.username].stats.wins++;
                    }
                    io.to(p.socketId).emit('updateStats', usersDB[p.username].stats);
                }
            });
            saveUsers();
            
            broadcastLeaderboardUpdate();

            setTimeout(() => {
                delete rooms[roomId];
                broadcastLobbyUpdate();
            }, 5000);
        }
        
        // 只有在回合未结束的情况下，才发送状态更新
        // endTurn 会自己调用 advanceToNextTurn 来发送更新，所以这里不需要
        io.to(roomId).emit('updateState', room);
    });

    socket.on('disconnecting', () => {
        if (socket.username && onlineUsers[socket.username]) {
            delete onlineUsers[socket.username];
            broadcastLeaderboardUpdate();
        }
        
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                const room = rooms[roomId];
                if(room) {
                    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
                    if(playerIndex !== -1) {
                        const player = room.players[playerIndex];
                        
                        if (player.is_alive) {
                            player.is_alive = false;
                            room.log.unshift(`[系统] 玩家 ${player.name} 掉线了！`);
                        }

                        if (room.phase !== 'waiting' && !room.gameOver && room.currentPlayerIndex === playerIndex) {
                            room.log.unshift(`[系统] 因当前回合玩家掉线，回合被强制结束。`);
                            advanceToNextTurn(roomId);
                        }
                    }

                    const alivePlayers = room.players.filter(p => p.is_alive);
                    if(alivePlayers.length <= 1 && room.phase !== 'waiting') {
                        if (turnTimers[roomId]) {
                            clearTimeout(turnTimers[roomId]);
                            delete turnTimers[roomId];
                        }
                        room.gameOver = true;
                        room.winner = alivePlayers.length === 1 ? alivePlayers[0].name : "平局";
                        room.log.unshift(`[系统] 游戏因玩家掉线而结束！胜利者是 ${room.winner}！`);
                         const winnerPlayer = alivePlayers.length === 1 ? alivePlayers[0] : null;
                         room.players.forEach(p => {
                            if(usersDB[p.username] && p.socketId !== socket.id) {
                                usersDB[p.username].stats.gamesPlayed++;
                                if(winnerPlayer && p.username === winnerPlayer.username) {
                                    usersDB[p.username].stats.wins++;
                                }
                                io.to(p.socketId).emit('updateStats', usersDB[p.username].stats);
                            }
                        });
                        saveUsers();
                        
                        broadcastLeaderboardUpdate();

                        setTimeout(() => {
                           delete rooms[roomId];
                           broadcastLobbyUpdate();
                        }, 5000);
                    }
                    io.to(roomId).emit('updateState', room);
                    broadcastLobbyUpdate();
                }
            }
        }
    });
});

// --- 5. 启动服务器 ---
httpServer.listen(port, () => console.log(`服务器已在端口 ${port} 启动`));