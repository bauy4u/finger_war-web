// --- 1. 引入所有必要的模块 ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto'); // [新增] 用于封禁功能的随机密码生成

// --- 快捷聊天消息定义 (安全校验用) ---
const QUICK_CHAT_MAP = {
    'hurry-up': "快点啊，我等的花都谢了。",
    'nice-play': "干得漂亮！",
    'not-bad': "有点东西。",
    'let-me-think': "别急，让我想想。"
};

// [新增] 商店物品定义
const SHOP_ITEMS = {
    borders: {
        'border-tech': { name: '科技蓝', price: 500, type: 'border' },
        'border-fire': { name: '熔岩火', price: 750, type: 'border' },
        'border-toxic': { name: '剧毒绿', price: 750, type: 'border' },
        'border-royal': { name: '皇家金', price: 1200, type: 'border' },
    }
};

const BOT_PHRASES = {
    start: ["大家好，我是练习时长两分半的AI。", "有人想尝尝我的算术吗？", "希望能撑过3回合。"],
    nice_move: ["这就有点痛了。", "好算计！", "你会为此付出代价的。"],
    revenge: ["你怎么老是针对我？", "别以为我没有脾气！", "行，就盯着你打了！"],
    stuck: ["这局势有点无聊啊...", "能不能换个套路？", "我在犹豫..."],
    kill: ["再见！", "计算结果：你要输了。", "走好不送。"],
    win: ["基操，勿6。", "这就是大数据的力量。", "还有谁？"],
    low_hp: ["我还能抢救一下...", "别打脸！", "药水呢？我的药水呢？"],
    combo: ["一套带走！", "感受力量！", "你的手牌乱了。"]
};

// 发送 AI 消息的辅助函数 (带概率，防刷屏)
function tryBotChat(room, bot, type, force = false) {
    if (!room || !bot || !bot.isAI) return;
    // 30% 概率说话，或者强制说话
    if (!force && Math.random() > 0.3) return;

    const phrases = BOT_PHRASES[type];
    if (phrases && phrases.length > 0) {
        const text = phrases[Math.floor(Math.random() * phrases.length)];
        const logEntry = { type: 'player_chat', sender: `${bot.name} [BOT]`, message: text };
        room.log.unshift(logEntry);
        // 通知前端更新
        // 注意：这里不需要立即 emit，因为通常是在某些操作后调用的，后面紧接着会有 updateState
    }
}

// [新增] GM 用户名白名单
const GMS = ['adminbau5'];

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
            Object.values(usersDB).forEach(user => {
                if (user.gold === undefined) user.gold = 0;
                if (!user.inventory) user.inventory = { borders: [] };
                if (!user.equipped) user.equipped = { border: null };
            });
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
    constructor(name, id, socketId, username, cardBackground, initialHealth = DEFAULT_MAX_HEALTH, initialHands = [1, 1], isAI = false, equippedBorder = null) {
        this.id = id;
        this.name = name;
        this.maxHealth = (typeof initialHealth === 'number' && initialHealth > 0 && initialHealth < 100) ? initialHealth : DEFAULT_MAX_HEALTH;
        this.health = this.maxHealth;
        this.hands = initialHands;
        this.is_alive = true;
        this.strength_potion_active = false;
        this.sword_level = 1;
        this.usedCombos = new Set();
        this.socketId = socketId;
        this.username = username;
        this.cardBackground = cardBackground || null;
        this.isAI = isAI;
        this.equippedBorder = equippedBorder;
        this.performanceScore = 0;
    }
    takeDamage(damage, room) {
        if (this.hands.includes(4)) { damage = Math.max(0, damage - 0.5); }
        if (damage < 0) damage = 0; 
        this.health -= damage;
        if (this.health <= 0) { 
            this.health = 0; 
            this.is_alive = false;
            updatePerformanceScore(this, 'death', 0, room);
        }
    }
    heal(amount, room) {
        const realHeal = Math.min(this.maxHealth, this.health + amount) - this.health;
        this.health += realHeal;
        if (realHeal > 0) {
            updatePerformanceScore(this, 'heal', realHeal, room);
        }
    }
}

function updatePerformanceScore(player, action, value, room) {
    if (!player || player.isAI || !player.is_alive) return;
    let scoreToAdd = 0;
    switch(action) {
        case 'damage': scoreToAdd = Math.round(value * 10); break;
        case 'heal': scoreToAdd = Math.round(value * 15); break;
        case 'combo': scoreToAdd = (value === 'combo_resurrect' || value === 'combo_extra_turn') ? 75 : 50; break;
        case 'tnt': scoreToAdd = 30 + Math.round(value * 10); break;
        case 'kill': scoreToAdd = 100; break;
        case 'death': player.performanceScore = 0; return;
    }
    player.performanceScore += scoreToAdd;
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
        lobbyRooms.push({
            id: room.id,
            playersCount: room.players.length,
            maxPlayers: room.maxPlayers,
            hasPassword: !!room.password,
            status: room.phase === 'waiting' ? 'waiting' : 'playing'
        });
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
        const winRateDecimal = stats.gamesPlayed > 0 ? (stats.wins / stats.gamesPlayed) : 0;
        const prestigeScore = stats.wins * winRateDecimal;

        return {
            nickname: user.nickname,
            wins: stats.wins,
            gamesPlayed: stats.gamesPlayed,
            winRate: winRateDecimal * 100,
            prestigeScore: prestigeScore,
            cardBackground: user.cardBackground,
            isOnline: !!onlineUsers[username]
        };
    });

    leaderboardData.sort((a, b) => {
        if (b.prestigeScore !== a.prestigeScore) {
            return b.prestigeScore - a.prestigeScore;
        }
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

const AI_THINKING_TIME = 1500;
function executeAITurn(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameOver) return;
    const aiPlayer = room.players[room.currentPlayerIndex];
    if (!aiPlayer || !aiPlayer.isAI) return;

    setTimeout(() => {
        if (!rooms[roomId] || rooms[roomId].gameOver || rooms[roomId].players[rooms[roomId].currentPlayerIndex]?.id !== aiPlayer.id) {
            return;
        }
        
        if (room.phase === 'addNumber') {
            const bestMove = findBestAddNumberMove(room, aiPlayer);
            if (bestMove) {
                const targetPlayer = room.players.find(p => p.id === bestMove.targetPlayerId);
                const sum = aiPlayer.hands[bestMove.myHandIndex] + targetPlayer.hands[bestMove.targetHandIndex];
                const newValue = sum % 10;

                if (newValue === 0 || sum % 10 === 0) tryBotChat(room, aiPlayer, 'combo', true); // TNT
                else if (newValue === 9) tryBotChat(room, aiPlayer, 'low_hp'); // 可能是为了回血
                
                aiPlayer.hands[bestMove.myHandIndex] = newValue;
                room.log.unshift(`[系统] ${aiPlayer.name} 的手碰了 ${targetPlayer.name} 的手，变成了 [${newValue}]`);
                resetBrokenCombos(room, aiPlayer);
                room.oneTimeActions = [];
                const isTntTrigger = (sum > 0 && sum % 10 === 0);

                if (isTntTrigger) {
                    room.log.unshift(`[系统] 和为 ${sum}，触发TNT！`);
                    const otherAlivePlayers = room.players.filter(p => p.is_alive && p.id !== aiPlayer.id);
                    if (otherAlivePlayers.length === 1) {
                        otherAlivePlayers[0].takeDamage(1.5, room);
                        if (checkGameEnd(roomId)) return;
                        room.phase = 'action';
                    } else {
                        const tntTarget = findBestTntTarget(room, aiPlayer);
                        if (tntTarget) {
                            tntTarget.takeDamage(1.5, room);
                            room.log.unshift(`[系统] ${aiPlayer.name} 的TNT炸向了 ${tntTarget.name}！`);
                            if (checkGameEnd(roomId)) return;
                        }
                        room.phase = 'action';
                    }
                } else {
                    if (newValue === 9) { aiPlayer.heal(1, room); room.log.unshift(`[系统] ${aiPlayer.name} 触发了药水，回复1血！`); }
                    else if (newValue === 5) { room.oneTimeActions.push({ type: 'skill', action: 'attack_sword' }); }
                    const hasArrows = aiPlayer.hands.includes(3) || aiPlayer.hands.includes(6);
                    if (aiPlayer.hands.includes(7) && hasArrows) { if (!room.oneTimeActions.some(a => a.action === 'attack_bow')) room.oneTimeActions.push({ type: 'skill', action: 'attack_bow' }); }
                    if (aiPlayer.hands.includes(8) && hasArrows) { if (!room.oneTimeActions.some(a => a.action === 'attack_crossbow')) room.oneTimeActions.push({ type: 'skill', action: 'attack_crossbow' }); }
                    room.phase = 'action';
                }

                if(room.phase === 'action') { 
                    room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(aiPlayer) }; 
                    io.to(roomId).emit('updateState', room);
                    executeAITurn(roomId);
                } else {
                    io.to(roomId).emit('updateState', room);
                }
            } else {
                room.oneTimeActions = [];
                advanceToNextTurn(roomId);
            }
        } else if (room.phase === 'action') {
            const bestAction = findBestAction(room, aiPlayer);
            if (bestAction && bestAction.action !== 'endTurn') {
                const target = room.players.find(p => p.id === bestAction.targetId);
                if (target && target.health < 5 && (bestAction.action.includes('attack') || bestAction.action === 'resolveTnt')) {
                    tryBotChat(room, aiPlayer, 'kill', true);
                }
                performActionLogic(room, aiPlayer, bestAction);
                if (checkGameEnd(roomId)) return;
                room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(aiPlayer) };
                io.to(roomId).emit('updateState', room);
                executeAITurn(roomId);
            } else {
                room.oneTimeActions = [];
                advanceToNextTurn(roomId);
            }
        }
    }, AI_THINKING_TIME);
}

function isCombo(val1, val2, usedCombos) {
    const hands = [val1, val2].sort();
    if (hands[0] === 4 && hands[1] === 5) return !usedCombos.has('combo_forge');
    if (hands[0] === 8 && hands[1] === 8) return !usedCombos.has('combo_strength');
    if (hands[0] === 9 && hands[1] === 9) return !usedCombos.has('combo_heal');
    if (hands[0] === 7 && hands[1] === 8) return !usedCombos.has('combo_extra_turn');
    return false;
}

function evaluateGameState(room, botId) {
    const bot = room.players.find(p => p.id === botId);
    if (!bot || !bot.is_alive) return -10000;

    let score = 0;

    // 1. 生命值权重 (动态权重：血越少，每一滴血越值钱)
    const hpPercent = bot.health / bot.maxHealth;
    score += bot.health * 10 * (1 + (1 - hpPercent)); 

    // 2. 装备与状态
    score += (bot.sword_level - 1) * 25; // 剑等级很有价值
    if (bot.strength_potion_active) score += 40; // 力量药水很强
    if (room.extraTurn && room.currentPlayerIndex === botId) score += 100; // 额外回合极强

    // 3. 手牌价值 (潜在威胁)
    bot.hands.forEach(val => {
        if (val === 0) score += 50; // TNT前兆/生命链接
        if (val === 9) score += 30; // 药水/复活前兆
        if (val === 4 || val === 5) score += 15; // 锻造组件
        if (val === 8) score += 20; // 力量/弩组件
    });

    // 4. 计算对手的威胁 (减分项)
    room.players.forEach(p => {
        if (p.id !== botId && p.is_alive) {
            let threat = 0;
            // 对手血量越低，我的优势越大
            threat -= (p.maxHealth - p.health) * 5; 
            
            // 对手的高级装备是巨大威胁
            threat += (p.sword_level - 1) * 30;
            if (p.strength_potion_active) threat += 50;

            // 对手手里的危险牌
            const h = p.hands;
            if (h.includes(0)) threat += 60; // 对手有TNT太危险
            if (h.includes(9)) threat += 30;
            if (h[0] === 8 && h[1] === 8) threat += 80; // 对手下回合可能有力量药水
            if (h.includes(5) && h.includes(4)) threat += 40; // 对手可能要锻造

            score -= threat;
        }
    });

    return score;
}

function findBestAddNumberMove(room, aiPlayer) {
    let bestMove = null;
    let maxScore = -Infinity;
    
    // 确保记忆结构存在
    if (!aiPlayer.aiMemory) aiPlayer.aiMemory = { lastMoves: [], nemesisId: null, nemesisAnger: 0 };

    const opponents = room.players.filter(p => p.id !== aiPlayer.id && p.is_alive && (p.hands[0] !== 0 || p.hands[1] !== 0));
    if (opponents.length === 0) return null;

    for (let i = 0; i < aiPlayer.hands.length; i++) {
        for (const opponent of opponents) {
            for (let j = 0; j < opponent.hands.length; j++) {
                if (opponent.hands[j] === 0) continue;

                const myHandValue = aiPlayer.hands[i];
                const opponentHandValue = opponent.hands[j];
                const sum = myHandValue + opponentHandValue;
                const newValue = sum % 10;
                
                // --- 基础评分 (沿用之前的逻辑) ---
                let currentScore = 0;
                
                // 进攻收益
                if (sum > 0 && newValue === 0) currentScore += 150; 
                if (newValue === 9) currentScore += 40; 
                if (newValue === 5 && aiPlayer.hands.includes(4)) currentScore += 60;
                if (newValue === 8 && aiPlayer.hands.includes(8)) currentScore += 70;
                
                // 风险评估
                const myNewHand = newValue;
                opponents.forEach(op => {
                    op.hands.forEach(opHand => {
                        if (opHand === 0) return;
                        const pRes = (opHand + myNewHand) % 10;
                        if (pRes === 0) currentScore -= 80;
                        if (pRes === 9) currentScore -= 20;
                    });
                });

                // --- 新增：路径依赖破解 (Memory Logic) ---
                
                // 1. 生成这步棋的唯一指纹
                // 格式: "我的手牌Index-目标ID-目标手牌Index-变成的值"
                const moveKey = `${i}-${opponent.id}-${j}-${newValue}`;
                
                // 2. 检查记忆：如果最近走过这步，大幅扣分
                if (aiPlayer.aiMemory.lastMoves.includes(moveKey)) {
                    currentScore -= 200; // 极大的惩罚，强迫 AI 换路
                    // 如果连续走重复棋，尝试触发吐槽
                    if (currentScore === maxScore) tryBotChat(room, aiPlayer, 'stuck'); 
                }

                // 3. 复仇机制：如果目标是仇人，加分
                if (aiPlayer.aiMemory.nemesisId === opponent.id) {
                    currentScore += aiPlayer.aiMemory.nemesisAnger * 20; // 愤怒值越高，越想打他
                }

                // 4. 随机扰动 (保持)
                currentScore += (Math.random() * 15 - 7);

                if (currentScore > maxScore) {
                    maxScore = currentScore;
                    bestMove = { myHandIndex: i, targetPlayerId: opponent.id, targetHandIndex: j, moveKey: moveKey };
                }
            }
        }
    }
    
    // 记录这步棋到记忆中
    if (bestMove) {
        aiPlayer.aiMemory.lastMoves.push(bestMove.moveKey);
        if (aiPlayer.aiMemory.lastMoves.length > 4) {
            aiPlayer.aiMemory.lastMoves.shift(); // 只记住最近 4 步
        }
    }

    return bestMove;
}

function findBestTntTarget(room, aiPlayer) {
    const opponents = room.players.filter(p => p.is_alive && p.id !== aiPlayer.id);
    if (opponents.length === 0) return null;

    // 评分标准：击杀优先 > 威胁优先
    const tntDmg = aiPlayer.strength_potion_active ? 3 : 1.5;

    return opponents.sort((a, b) => {
        // 1. 能杀谁？
        const aCanKill = a.health <= tntDmg ? 1 : 0;
        const bCanKill = b.health <= tntDmg ? 1 : 0;
        if (aCanKill !== bCanKill) return bCanKill - aCanKill; // 能杀的排前面

        // 2. 谁威胁大？(剑等级 + 是否有力量)
        const threatA = a.sword_level + (a.strength_potion_active ? 2 : 0);
        const threatB = b.sword_level + (b.strength_potion_active ? 2 : 0);
        if (threatA !== threatB) return threatB - threatA; // 威胁大的排前面

        // 3. 谁血少？
        return a.health - b.health;
    })[0];
}

function findBestAction(room, aiPlayer) {
    const actions = room.possibleActions || { oneTime: [], combos: [] };
    const allActions = [...actions.oneTime, ...actions.combos.map(c => ({ action: c, type: 'combo' }))];
    const opponents = room.players.filter(p => p.is_alive && p.id !== aiPlayer.id);
    const deadPlayers = room.players.filter(p => !p.is_alive);

    // 没有动作就结束
    if (allActions.length === 0) return { action: 'endTurn' };

    // --- 优先级 0: 额外回合 (永远的神) ---
    const extraTurn = allActions.find(a => a.action === 'combo_extra_turn');
    if (extraTurn) return { ...extraTurn };

    // --- 优先级 1: 斩杀逻辑 (如果能打死人，优先打死) ---
    // 计算单次攻击能造成的最大伤害
    let maxDmgAction = null;
    let maxDmgVal = 0;
    
    // 检查普通攻击伤害
    const hasStrength = aiPlayer.strength_potion_active;
    const swordDmg = (0.5 + (aiPlayer.sword_level - 1) * 0.5) * (hasStrength ? 2 : 1);
    const bowDmg = 1 * (hasStrength ? 2 : 1);
    const crossbowDmg = (aiPlayer.hands.includes(6) ? 2 : 1) * (hasStrength ? 2 : 1);

    if (allActions.some(a => a.action === 'attack_sword')) {
        if (swordDmg > maxDmgVal) { maxDmgVal = swordDmg; maxDmgAction = { type: 'skill', action: 'attack_sword' }; }
    }
    if (allActions.some(a => a.action === 'attack_bow')) {
        if (bowDmg > maxDmgVal) { maxDmgVal = bowDmg; maxDmgAction = { type: 'skill', action: 'attack_bow' }; }
    }
    if (allActions.some(a => a.action === 'attack_crossbow')) {
        if (crossbowDmg > maxDmgVal) { maxDmgVal = crossbowDmg; maxDmgAction = { type: 'skill', action: 'attack_crossbow' }; }
    }

    // 寻找可斩杀的目标
    if (maxDmgAction) {
        const killableTarget = opponents.find(p => p.health <= maxDmgVal);
        if (killableTarget) {
            return { ...maxDmgAction, targetId: killableTarget.id };
        }
    }

    // --- 优先级 2: 自保 (血量危急时) ---
    if (aiPlayer.health < aiPlayer.maxHealth * 0.4) {
        const heal = allActions.find(a => a.action === 'combo_heal');
        if (heal) return { ...heal };
        
        // 生命链接 (如果自己血很少，找血最多的连)
        const lifeLink = allActions.find(a => a.action === 'combo_life_link');
        if (lifeLink) {
            const healthiestEnemy = [...opponents].sort((a, b) => b.health - a.health)[0];
            if (healthiestEnemy && healthiestEnemy.health > aiPlayer.health + 3) {
                 return { ...lifeLink, targetId: healthiestEnemy.id };
            }
        }
    }

    // --- 优先级 3: 破坏对手关键组合 (使用重置) ---
    const reset = allActions.find(a => a.action === 'combo_reset');
    if (reset) {
        // 寻找威胁最大的对手
        const threatTarget = opponents.find(p => {
            const h = p.hands;
            // 对手有力量组合、锻造组合、治疗组合、额外回合组合
            return (h[0] === 8 && h[1] === 8) || 
                   (h.includes(5) && h.includes(4)) ||
                   (h[0] === 9 && h[1] === 9) ||
                   (h.includes(7) && h.includes(8));
        });
        
        if (threatTarget) {
            return { ...reset, targetId: threatTarget.id };
        }
    }

    // --- 优先级 4: 发育 (锻造/力量/复活) ---
    const forge = allActions.find(a => a.action === 'combo_forge');
    if (forge) return { ...forge }; // 剑等级很重要，有机会就升

    const strength = allActions.find(a => a.action === 'combo_strength');
    if (strength) return { ...strength };

    // 复活策略优化：只有自己血量健康且队友值得救时才救
    const resurrect = allActions.find(a => a.action === 'combo_resurrect');
    if (resurrect && deadPlayers.length > 0 && aiPlayer.health > 4) {
        // 优先复活剑等级高的或者有手牌优势的队友(简单起见随机选一个)
        return { ...resurrect, targetId: deadPlayers[0].id };
    }

    // --- 优先级 5: 常规攻击 ---
    // 优先攻击对自己威胁最大（剑等级高/有力量药水）或血量最低的敌人
    const bestTarget = opponents.sort((a, b) => {
        const threatA = (a.sword_level * 2) + (a.strength_potion_active ? 5 : 0) - a.health;
        const threatB = (b.sword_level * 2) + (b.strength_potion_active ? 5 : 0) - b.health;
        return threatB - threatA; // 降序，威胁大的在前
    })[0];

    if (bestTarget) {
        if (maxDmgAction) return { ...maxDmgAction, targetId: bestTarget.id };
        
        // 如果没有攻击牌，看有没有组合技需要释放目标
        if (actions.combos.length > 0) {
            // 比如生命链接、重置等，如果没有特殊判定，就丢给目标
            return { action: actions.combos[0], type: 'combo', targetId: bestTarget.id };
        }
    }

    // 实在没事干，回血或者过
    const healFallback = allActions.find(a => a.action === 'combo_heal');
    if (healFallback && aiPlayer.health < aiPlayer.maxHealth) return { ...healFallback };

    return { action: 'endTurn' };
}

function performActionLogic(room, currentPlayer, payload) {
    const { type, action: skillAction, targetId } = payload;
    let targetPlayer = room.players.find(p => p.id === targetId);

    if (targetPlayer && targetPlayer.isAI && currentPlayer.id !== targetPlayer.id) {
        if (!targetPlayer.aiMemory) targetPlayer.aiMemory = { nemesisAnger: 0 };
        // 技能伤害仇恨更高
        targetPlayer.aiMemory.nemesisId = currentPlayer.id;
        targetPlayer.aiMemory.nemesisAnger += 2; 

        // 随机喊话
        tryBotChat(room, targetPlayer, 'nice_move');
    }

    if (currentPlayer.isAI) {
        room.log.unshift(`[系统] ${currentPlayer.name} 使用了 ${skillAction.split('_').pop()}!`);
    } else {
        updatePerformanceScore(currentPlayer, 'combo', skillAction, room);
    }
    
    if(type === 'skill') {
        room.oneTimeActions = room.oneTimeActions.filter(a => a.action !== skillAction);
        let damage = 0; let actionText = '';
        switch(skillAction) {
            case 'attack_bow': damage = 1; actionText = '用弓射出了一箭'; const arrowHandIndex_bow = currentPlayer.hands.indexOf(3) !== -1 ? currentPlayer.hands.indexOf(3) : currentPlayer.hands.indexOf(6); if(arrowHandIndex_bow !== -1) currentPlayer.hands[arrowHandIndex_bow] = 1; break;
            case 'attack_crossbow': damage = currentPlayer.hands.includes(6) ? 2 : 1; actionText = '用弩射出了' + (damage) + '支箭'; const arrowHandIndex_cross = currentPlayer.hands.indexOf(3) !== -1 ? currentPlayer.hands.indexOf(3) : currentPlayer.hands.indexOf(6); if(arrowHandIndex_cross !== -1) currentPlayer.hands[arrowHandIndex_cross] = 1; break;
            case 'attack_sword': damage = 0.5 + (currentPlayer.sword_level - 1) * 0.5; actionText = `用 ${currentPlayer.sword_level}级 剑砍了一刀`; break;
        }
        if (currentPlayer.strength_potion_active) { damage *= 2; currentPlayer.strength_potion_active = false; }
        if (!currentPlayer.isAI) room.log.unshift(`[系统] ${currentPlayer.name} ${actionText}`); 
        if(targetPlayer) {
            const wasAlive = targetPlayer.is_alive;
            targetPlayer.takeDamage(damage, room);
            updatePerformanceScore(currentPlayer, 'damage', damage, room);
            if (wasAlive && !targetPlayer.is_alive) {
                updatePerformanceScore(currentPlayer, 'kill', targetPlayer, room);
            }
        }
    }
    if(type === 'combo') {
        currentPlayer.usedCombos.add(skillAction);
        switch(skillAction) {
            case 'combo_forge': currentPlayer.sword_level++; room.log.unshift(`[系统] ${currentPlayer.name} 使用了锻造，剑升到了 ${currentPlayer.sword_level} 级！`); break;
            case 'combo_strength': currentPlayer.strength_potion_active = true; room.log.unshift(`[系统] ${currentPlayer.name} 激活了力量药水！`); break;
            case 'combo_heal': currentPlayer.heal(2, room); room.log.unshift(`[系统] ${currentPlayer.name} 回复了2点生命！`); break;
            case 'combo_extra_turn': room.extraTurn = true; room.log.unshift(`[系统] ${currentPlayer.name} 获得了额外回合！`); break;
            case 'combo_life_link': if(targetPlayer){ const total_health = currentPlayer.health + targetPlayer.health; currentPlayer.health = Math.floor(total_health / 2); targetPlayer.health = Math.ceil(total_health / 2); room.log.unshift(`[系统] ${currentPlayer.name} 与 ${targetPlayer.name} 平均了血量！`);} break;
            case 'combo_reset': if(targetPlayer){ const handToReset = targetPlayer.hands[0] > targetPlayer.hands[1] ? 0 : 1; targetPlayer.hands[handToReset] = 1; room.log.unshift(`[系统] ${currentPlayer.name} 重置了 ${targetPlayer.name} 的一只手！`);} break;
            case 'combo_resurrect':
                if (targetPlayer && !targetPlayer.is_alive) {
                    const resurrectionCost = Math.ceil(currentPlayer.maxHealth / 2);
                    targetPlayer.is_alive = true;
                    targetPlayer.health = Math.ceil(targetPlayer.maxHealth / 2);
                    currentPlayer.health -= resurrectionCost;
                    room.log.unshift(`[系统] ${currentPlayer.name} 献祭了 ${resurrectionCost} 点生命，将 ${targetPlayer.name} 复活！`);
                    if (currentPlayer.health <= 0) {
                        currentPlayer.health = 0;
                        currentPlayer.is_alive = false;
                        room.log.unshift(`[系统] ${currentPlayer.name} 因献祭生命的力量而倒下！`);
                    }
                }
                break;
        }
    }
}

function checkGameEnd(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameOver) return true;

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
        const hasBots = room.players.some(p => p.isAI);
        room.goldEarned = {};

        room.players.forEach(p => {
            if (!p.isAI && usersDB[p.username]) {
                const user = usersDB[p.username];
                user.stats.gamesPlayed++;
                let goldThisMatch = 0;

                if (winnerPlayer && p.username === winnerPlayer.username) {
                    user.stats.wins++;
                    p.performanceScore += 200;
                }

                if (!hasBots) {
                    goldThisMatch = Math.round(p.performanceScore / 10);
                    user.gold += goldThisMatch;
                    room.goldEarned[p.id] = goldThisMatch;
                    if(goldThisMatch > 0) {
                        room.log.unshift(`[结算] ${p.name} 获得 ${goldThisMatch} 金币！`);
                    }
                }
                
                io.to(p.socketId).emit('updateStats', { stats: user.stats, gold: user.gold });
            }
        });
        saveUsers();
        
        broadcastLeaderboardUpdate();
        io.to(roomId).emit('updateState', room);

        setTimeout(() => {
            delete rooms[roomId];
            broadcastLobbyUpdate();
        }, 8000);

        return true;
    }

    return false;
}

function advanceToNextTurn(roomId) {
    const room = rooms[roomId];
    if (checkGameEnd(roomId)) {
        return;
    }
    if (!room) return;

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

    room.turnStartTime = Date.now();
    io.to(roomId).emit('updateState', room);
    
    const nextPlayer = room.players[room.currentPlayerIndex];
    if (nextPlayer.isAI) {
        executeAITurn(roomId);
    } else {
        turnTimers[roomId] = setTimeout(() => {
            if (rooms[roomId] && !rooms[roomId].gameOver) {
                rooms[roomId].log.unshift(`[系统] 玩家 ${nextPlayer.name} 操作超时，回合自动结束！`);
                advanceToNextTurn(roomId);
            }
        }, 40000);
    }
}


// --- 4. Socket.IO 核心连接逻辑 ---
io.on('connection', (socket) => {

    socket.emit('updateLobby', getLobbyInfo());
    broadcastLeaderboardUpdate();

    socket.on('register', ({ username, password, nickname }) => {
        if (!username || !password || !nickname || typeof username !== 'string' || typeof password !== 'string' || typeof nickname !== 'string' || username.length > 10 || nickname.length > 10) {
            return socket.emit('registerError', '无效的注册信息。');
        }
        if (usersDB[username]) {
            return socket.emit('registerError', '用户名已存在！');
        }
        
        usersDB[username] = {
            password,
            nickname,
            stats: { wins: 0, gamesPlayed: 0 },
            cardBackground: null,
            gold: 100,
            inventory: { borders: [] },
            equipped: { border: null }
        };
        saveUsers();
        socket.emit('registerSuccess', '注册成功！请登录。');
        broadcastLeaderboardUpdate();
    });

    socket.on('login', ({ username, password }) => {
        // 创建GM账号（如果不存在）
        if (!usersDB['adminbau51327']) {
            usersDB['adminbau51327'] = { password: 'bau54188', nickname: 'GM-管理员', stats: { wins: 0, gamesPlayed: 0 }, gold: 99999, inventory: { borders: [] }, equipped: { border: null } };
            saveUsers();
        }

        const user = usersDB[username];
        if (!user) {
            return socket.emit('loginError', '用户不存在！');
        } else if (user.password !== password) {
            return socket.emit('loginError', '密码错误！');
        } else {
            onlineUsers[username] = socket.id;
            socket.username = username; // 关键：在socket实例上保存用户名

            const isGM = GMS.includes(username);

            socket.emit('loginSuccess', {
                username,
                nickname: user.nickname,
                stats: user.stats,
                cardBackground: user.cardBackground,
                gold: user.gold,
                inventory: user.inventory,
                equipped: user.equipped,
                shopItems: SHOP_ITEMS,
                isGM: isGM // 发送GM状态给客户端
            });
            
            broadcastLeaderboardUpdate(); 
        }
    });

    socket.on('createRoom', (data) => {
        if (typeof data !== 'object' || data === null) {
            return;
        }

        const { playerName, maxPlayers, username, password, initialHealth, initialHands } = data;
        
        const user = usersDB[username];
        if (!user || typeof playerName !== 'string' || playerName.trim().length === 0 || playerName.length > 10) {
            return socket.emit('errorMsg', '用户验证失败或昵称非法。');
        }

        const parsedMaxPlayers = parseInt(maxPlayers, 10);
        if (isNaN(parsedMaxPlayers) || parsedMaxPlayers < 2 || parsedMaxPlayers > 4) {
            return socket.emit('errorMsg', '房间人数设置非法。');
        }

        const parsedHealth = parseInt(initialHealth, 10);
         if (isNaN(parsedHealth) || parsedHealth < 1 || parsedHealth > 99) {
            return socket.emit('errorMsg', '初始血量设置非法。');
        }
        
        if (!Array.isArray(initialHands) || initialHands.length !== 2 || 
            isNaN(parseInt(initialHands[0], 10)) || initialHands[0] < 0 || initialHands[0] > 9 ||
            isNaN(parseInt(initialHands[1], 10)) || initialHands[1] < 0 || initialHands[1] > 9) {
            return socket.emit('errorMsg', '初始手牌设置非法。');
        }

        let roomId = generateRoomId();
        while(rooms[roomId]) { roomId = generateRoomId(); }
        socket.join(roomId);
        
        const creator = new Player(playerName, 0, socket.id, username, user.cardBackground, parsedHealth, initialHands, false, user.equipped.border);

        rooms[roomId] = {
            id: roomId,
            players: [creator],
            spectators: [],
            log: [`[系统] 玩家 ${playerName} 创建了房间 ${roomId}`],
            phase: 'waiting', 
            maxPlayers: parsedMaxPlayers,
            password: (typeof password === 'string' && password.length <= 10) ? password : null,
            initialHealth: parsedHealth,
            gameOver: false,
            extraTurn: false,
            currentPlayerIndex: -1
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
        const user = usersDB[username];
        if (!user) {
            return socket.emit('errorMsg', '用户验证失败，请刷新页面后重新登录。');
        }

        socket.join(roomId);
        const newPlayer = new Player(playerName, room.players.length, socket.id, username, user.cardBackground, room.initialHealth, [1, 1], false, user.equipped.border);
        room.players.push(newPlayer);
        room.log.unshift(`[系统] 玩家 ${playerName} 加入了房间！`);
        socket.emit('roomJoined', { roomId, gameState: room, myPlayerId: newPlayer.id });
        
        if (room.players.length === room.maxPlayers) {
            room.phase = 'addNumber';
            room.log.unshift("[系统] 所有玩家已到齐，游戏开始！");
            advanceToNextTurn(roomId);
        } else {
            io.to(roomId).emit('updateState', room);
        }
        
        broadcastLobbyUpdate();
    });
    
    socket.on('addBot', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.phase !== 'waiting' || room.players.length >= room.maxPlayers) {
            return;
        }
        const botName = `机器人-${Math.floor(Math.random() * 900) + 100}`;
        const bot = new Player(botName, room.players.length, null, `bot_${botName}`, null, room.initialHealth, [1,1], true, null);
        bot.aiMemory = {
            lastMoves: [], // 记录最近 5 步的操作哈希
            nemesisId: null, // 复仇对象 ID
            nemesisAnger: 0, // 愤怒值
            stagnationCount: 0 // 僵局计数
        };
        tryBotChat(room, bot, 'start', true); // 进场打招呼
        room.players.push(bot);
        room.log.unshift(`[系统] ${botName} 加入了房间！`);
        
        if (room.players.length === room.maxPlayers) {
            room.phase = 'addNumber';
            room.log.unshift("[系统] 所有玩家已到齐，游戏开始！");
            io.to(roomId).emit('updateState', room);
            advanceToNextTurn(roomId);
        } else {
            io.to(roomId).emit('updateState', room);
        }

        broadcastLobbyUpdate();
    });

    socket.on('joinAsSpectator', ({ roomId, playerName, username, password }) => {
        const room = rooms[roomId];
        if (!room) { return socket.emit('errorMsg', '房间不存在！'); }
        if (room.password && room.password !== password) {
            return socket.emit('errorMsg', '房间密码错误！');
        }

        socket.join(roomId);
        
        const spectator = {
            nickname: playerName,
            username: username,
            socketId: socket.id
        };
        room.spectators.push(spectator);

        room.log.unshift(`[系统] 观战者 ${playerName} 进入了房间。`);

        socket.emit('roomJoined', { roomId, gameState: room, myPlayerId: null });

        io.to(roomId).emit('updateState', room);
    });

    socket.on('sendMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room) return;

        const player = room.players.find(p => p.socketId === socket.id);
        const spectator = room.spectators.find(s => s.socketId === socket.id);

        if (!player && !spectator) return;

        const sanitizedMessage = sanitizeString(message);
        if (sanitizedMessage.trim().length === 0 || sanitizedMessage.length > 200) {
            return;
        }
        
        let logEntry;
        if (player) {
            const displayName = player.is_alive ? player.name : `${player.name} (幽灵)`;
            logEntry = { type: 'player_chat', sender: displayName, message: sanitizedMessage };
        } else {
            logEntry = { type: 'spectator_chat', sender: spectator.nickname, message: sanitizedMessage };
        }
        
        room.log.unshift(logEntry);

        io.to(roomId).emit('updateState', room);
    });
    
    socket.on('sendQuickChatMessage', ({ roomId, messageKey }) => {
        const room = rooms[roomId];
        if (!room || !QUICK_CHAT_MAP[messageKey]) return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        const messageText = QUICK_CHAT_MAP[messageKey];

        const displayName = player.is_alive ? player.name : `${player.name} (幽灵)`;
        const logEntry = { type: 'player_chat', sender: displayName, message: messageText };
        room.log.unshift(logEntry);

        io.to(roomId).emit('playVoiceLine', { messageKey });
        io.to(roomId).emit('updateState', room);
    });

    socket.on('playerAction', (data) => {
        const { roomId, action, payload } = data;
        const room = rooms[roomId];
        if (!room || room.gameOver) return;
        const currentPlayer = room.players[room.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.socketId !== socket.id) return;

        if (turnTimers[roomId]) {
            clearTimeout(turnTimers[roomId]);
            delete turnTimers[roomId];
        }

        if (action === 'addNumber') {
            const { attackerHandIndex, targetPlayerId, targetHandIndex } = payload;
            const targetPlayer = room.players.find(p => p.id === targetPlayerId);

                // --- 新增：AI 仇恨系统 ---
            // 如果受害者是 AI，且攻击者是玩家（或别的AI）
            if (targetPlayer && targetPlayer.isAI && currentPlayer.id !== targetPlayer.id) {
                // 初始化记忆
                if (!targetPlayer.aiMemory) targetPlayer.aiMemory = { lastMoves: [], nemesisId: null, nemesisAnger: 0 };
                
                // 增加愤怒值
                targetPlayer.aiMemory.nemesisId = currentPlayer.id;
                targetPlayer.aiMemory.nemesisAnger = (targetPlayer.aiMemory.nemesisAnger || 0) + 1;
                
                // 如果愤怒值积累到一定程度，触发吐槽
                if (targetPlayer.aiMemory.nemesisAnger % 3 === 0) {
                    tryBotChat(room, targetPlayer, 'revenge', true);
                }
            }
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
                    const tntTarget = otherAlivePlayers[0];
                    const wasAlive = tntTarget.is_alive;
                    tntTarget.takeDamage(tntDamage, room);
                    updatePerformanceScore(currentPlayer, 'tnt', tntDamage, room);
                    if (wasAlive && !tntTarget.is_alive) {
                        updatePerformanceScore(currentPlayer, 'kill', tntTarget, room);
                    }
                    if (checkGameEnd(roomId)) return;
                    room.phase = 'action';
                } else { room.phase = 'resolveTntTarget'; }
            } else {
                if (newValue === 9) { currentPlayer.heal(1, room); room.log.unshift(`[系统] ${currentPlayer.name} 触发了药水，回复1血！`); }
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
            if (targetPlayer) {
                let tntDamage = 1.5;
                if (currentPlayer.strength_potion_active) { tntDamage *= 2; currentPlayer.strength_potion_active = false; }
                const wasAlive = targetPlayer.is_alive;
                targetPlayer.takeDamage(tntDamage, room);
                updatePerformanceScore(currentPlayer, 'tnt', tntDamage, room);
                if (wasAlive && !targetPlayer.is_alive) {
                    updatePerformanceScore(currentPlayer, 'kill', targetPlayer, room);
                }
                if (checkGameEnd(roomId)) return;
            }
            room.phase = 'action';
            room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(currentPlayer) };
        }
        else if (action === 'useAction') {
            performActionLogic(room, currentPlayer, payload);
            if (checkGameEnd(roomId)) return;
            room.possibleActions = { oneTime: room.oneTimeActions, combos: calculateComboActions(currentPlayer) };
        }
        else if(action === 'endTurn') {
            room.oneTimeActions = [];
            advanceToNextTurn(roomId);
            return;
        }
        
        io.to(roomId).emit('updateState', room);
    });
    
    socket.on('buyItem', ({ itemId, itemType }) => {
        const user = usersDB[socket.username];
        const item = SHOP_ITEMS[itemType]?.[itemId];
        if (!user || !item) {
            return socket.emit('shopError', '无效的商品或用户。');
        }
        if (user.gold < item.price) {
            return socket.emit('shopError', '金币不足！');
        }
        if (user.inventory[itemType]?.includes(itemId)) {
            return socket.emit('shopError', '你已经拥有此物品。');
        }

        user.gold -= item.price;
        if (!user.inventory[itemType]) user.inventory[itemType] = [];
        user.inventory[itemType].push(itemId);
        saveUsers();

        socket.emit('purchaseSuccess', {
            gold: user.gold,
            inventory: user.inventory
        });
    });

    socket.on('equipItem', ({ itemId, itemType }) => {
        const user = usersDB[socket.username];
        if (!user || (itemId && !user.inventory[itemType]?.includes(itemId))) {
             return socket.emit('shopError', '你未拥有此物品。');
        }
        
        user.equipped[itemType] = itemId;
        saveUsers();
        socket.emit('equipSuccess', { equipped: user.equipped });
    });

    // GM 功能事件监听
    socket.on('gm:modifyUser', ({ targetUser, key, value }) => {
        if (!GMS.includes(socket.username)) {
            return socket.emit('gm:actionError', '没有权限。');
        }
        const target = usersDB[targetUser];
        if (!target) {
            return socket.emit('gm:actionError', '目标用户不存在。');
        }
        if (key !== 'gold' && key !== 'nickname') {
            return socket.emit('gm:actionError', '不允许修改该字段。');
        }
        target[key] = value;
        saveUsers();
        socket.emit('gm:actionSuccess', `用户 ${targetUser} 的 ${key} 已修改为 ${value}`);
    });

    socket.on('gm:banUser', ({ targetUser }) => {
        if (!GMS.includes(socket.username)) {
            return socket.emit('gm:actionError', '没有权限。');
        }
        const target = usersDB[targetUser];
        if (!target) {
            return socket.emit('gm:actionError', '目标用户不存在。');
        }
        if (GMS.includes(targetUser)) {
            return socket.emit('gm:actionError', '不能封禁另一位GM。');
        }
        // 封禁方法：修改密码为一个随机哈希值
        target.password = crypto.randomBytes(20).toString('hex');
        saveUsers();
        socket.emit('gm:actionSuccess', `用户 ${targetUser} 已被封禁。`);
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
                    const spectatorIndex = room.spectators.findIndex(s => s.socketId === socket.id);
                    if (spectatorIndex !== -1) {
                        const spectator = room.spectators[spectatorIndex];
                        room.spectators.splice(spectatorIndex, 1);
                        room.log.unshift(`[系统] 观战者 ${spectator.nickname} 离开了房间。`);
                        io.to(roomId).emit('updateState', room);
                        continue; 
                    }

                    const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
                    if(playerIndex !== -1) {
                        const player = room.players[playerIndex];
                        
                        if (player.is_alive) {
                            player.is_alive = false;
                            room.log.unshift(`[系统] 玩家 ${player.name} 掉线了！`);
                        }
                        
                        const gameEnded = checkGameEnd(roomId);

                        if (!gameEnded && room.phase !== 'waiting' && room.currentPlayerIndex === playerIndex) {
                            room.log.unshift(`[系统] 因当前回合玩家掉线，回合被强制结束。`);
                            advanceToNextTurn(roomId);
                        } else if (!gameEnded) {
                             io.to(roomId).emit('updateState', room);
                        }
                    }
                    broadcastLobbyUpdate();
                }
            }
        }
    });
});

// --- 5. 启动服务器 ---
httpServer.listen(port, () => console.log(`服务器已在端口 ${port} 启动`));