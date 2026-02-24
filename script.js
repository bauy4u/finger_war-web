document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM 元素引用保持不变，确保兼容性
    const dom = {
        authContainer: document.getElementById('auth-container'),
        loginView: document.getElementById('login-view'),
        registerView: document.getElementById('register-view'),
        loginForm: document.getElementById('login-form'),
        registerForm: document.getElementById('register-form'),
        showRegister: document.getElementById('show-register'),
        showLogin: document.getElementById('show-login'),
        userProfile: document.getElementById('user-profile'),
        profileNickname: document.getElementById('profile-nickname'),
        profileStats: document.getElementById('profile-stats'),
        logoutBtn: document.getElementById('logout-btn'),

        showUploadModalBtn: document.getElementById('show-upload-modal-btn'),
        uploadModal: document.getElementById('upload-modal'),
        imageInput: document.getElementById('image-input'),
        imageToCrop: document.getElementById('image-to-crop'),
        confirmUploadBtn: document.getElementById('confirm-upload-btn'),
        cancelUploadBtn: document.getElementById('cancel-upload-btn'),

        appContainer: document.getElementById('app-container'),
        roomManagement: document.getElementById('room-management'),
        mainContent: document.getElementById('main-content'),
        createRoomBtn: document.getElementById('create-room-btn'),
        maxPlayersSelect: document.getElementById('max-players-select'),
        roomIdInput: document.getElementById('room-id-input'),
        joinRoomBtn: document.getElementById('join-room-btn'),
        addBotBtn: document.getElementById('add-bot-btn'),
        waitingActions: document.getElementById('waiting-actions'),
        roomInfo: document.getElementById('room-info'),
        gameBoard: document.getElementById('game-board'),
        playersContainer: document.getElementById('players-container'),
        turnIndicator: document.getElementById('turn-indicator'),
        turnIndicatorText: document.getElementById('turn-indicator-text'),
        turnTimer: document.getElementById('turn-timer'),
        logList: document.getElementById('log-list'),
        spectatorBox: document.getElementById('spectator-box'),
        spectatorCount: document.getElementById('spectator-count'),
        spectatorList: document.getElementById('spectator-list'),
        gameOverModal: document.getElementById('game-over-modal'),
        winnerText: document.getElementById('winner-text'),
        playAgainBtn: document.getElementById('play-again-btn'),
        addNumberPanel: document.getElementById('add-number-panel'),
        actionPhasePanel: document.getElementById('action-phase-panel'),
        confirmAddBtn: document.getElementById('confirm-add-btn'),
        resetSelectionBtn: document.getElementById('reset-selection-btn'),
        skillButtonsContainer: document.getElementById('skill-buttons-container'),
        endTurnBtn: document.getElementById('end-turn-btn'),
        actionPrompt: document.getElementById('action-prompt'),
        actionPhasePrompt: document.getElementById('action-phase-prompt'),
        attackSound: document.getElementById('attack-sound'),
        
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        quickChatBtn: document.getElementById('quick-chat-btn'),
        quickChatPanel: document.getElementById('quick-chat-panel'),

        createRoomPassword: document.getElementById('create-room-password'),
        joinRoomPassword: document.getElementById('join-room-password'),
        roomListBody: document.getElementById('room-list-body'),

        initialHealth: document.getElementById('initial-health'),
        initialHand1: document.getElementById('initial-hand-1'),
        initialHand2: document.getElementById('initial-hand-2'),
        
        profileGold: document.getElementById('profile-gold'),
        shopBtn: document.getElementById('shop-btn'),
        shopModal: document.getElementById('shop-modal'),
        closeShopBtn: document.getElementById('close-shop-btn'),
        previewCard: document.getElementById('preview-card'),
        previewBorder: document.getElementById('preview-border'),
        previewNickname: document.getElementById('preview-nickname'),
        borderItemsList: document.getElementById('border-items-list'),
        goldEarnedText: document.getElementById('gold-earned-text'),

        gmPanelBtn: document.getElementById('gm-panel-btn'),
        gmModal: document.getElementById('gm-modal'),
        closeGmModalBtn: document.getElementById('close-gm-modal-btn'),
        gmModifyForm: document.getElementById('gm-modify-form'),
        gmBanForm: document.getElementById('gm-ban-form'),
    };
    
    const ITEM_MAP = { 3: '箭矢x1', 4: '盾牌', 5: '剑', 6: '箭矢x2', 7: '弓', 8: '弩', 9: '药水', 0: 'TNT' };
    
    const QUICK_CHAT_MESSAGES = {
        'hurry-up': { text: "快点啊，我等的花都谢了。", audioId: 'voice-hurry-up' },
        'nice-play': { text: "干得漂亮！", audioId: 'voice-nice-play' },
        'not-bad': { text: "有点东西。", audioId: 'voice-not-bad' },
        'let-me-think': { text: "别急，让我想想。", audioId: 'voice-let-me-think' }
    };

    let gameState = null;
    let myPlayerId = null;
    let roomId = null;
    let selection = { attackerHandIndex: null, targetPlayerId: null, targetHandIndex: null };
    let isWaitingForTarget = null;
    let isAnimating = false;
    let currentUser = null;
    let cropper = null;
    let turnTimerInterval = null;
    let voiceCooldownInterval = null;
    let shopItems = null;
    let currentPreview = { border: null };


    // --- 认证 Socket 事件监听 ---
    socket.on('loginSuccess', (user) => {
        currentUser = user;
        shopItems = user.shopItems;
        dom.authContainer.classList.add('hidden');
        dom.roomManagement.classList.remove('hidden');
        updateProfileUI();
        setupShop();

        if (user.isGM) {
            dom.gmPanelBtn.classList.remove('hidden');
            setupGMPanel();
        }
    });

    socket.on('loginError', (message) => alert(`登录失败: ${message}`));
    socket.on('registerSuccess', (message) => {
        alert(message);
        dom.registerView.classList.add('hidden');
        dom.loginView.classList.remove('hidden');
    });
    socket.on('registerError', (message) => alert(`注册失败: ${message}`));
    
    socket.on('updateStats', (data) => {
        if (currentUser) {
            currentUser.stats = data.stats;
            if (data.gold !== undefined) {
                currentUser.gold = data.gold;
            }
            updateProfileUI();
        }
    });

    socket.on('shopError', (message) => {
        alert(message);
    });

    socket.on('purchaseSuccess', (data) => {
        alert('购买成功！');
        currentUser.gold = data.gold;
        currentUser.inventory = data.inventory;
        updateProfileUI();
        renderShopItems();
    });

    socket.on('equipSuccess', (data) => {
        currentUser.equipped = data.equipped;
        renderShopItems();
    });

    socket.on('gm:actionSuccess', (message) => {
        alert(`GM操作成功: ${message}`);
    });
    socket.on('gm:actionError', (message) => {
        alert(`GM操作失败: ${message}`);
    });

    function updateProfileUI() {
        if(currentUser) {
            dom.profileNickname.textContent = currentUser.nickname;
            dom.profileStats.textContent = `${currentUser.stats.wins} 胜`; // 简化显示
            dom.profileGold.textContent = currentUser.gold;
        }
    }


    // --- 游戏 Socket 事件监听 ---
    socket.on('updateLobby', (rooms) => {
        const roomListBody = dom.roomListBody;
        if (!roomListBody) return;

        roomListBody.innerHTML = '';
        if (rooms.length === 0) {
            roomListBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: #64748b;">暂无房间，快去创建一个吧！</td></tr>`;
            return;
        }

        rooms.forEach(room => {
            const row = document.createElement('tr');
            
            const isPlaying = room.status === 'playing';
            // 使用新的按钮样式
            const buttonClass = isPlaying ? 'btn-secondary btn-sm' : 'btn-success btn-sm';
            const buttonText = isPlaying ? '👁️ 观战' : '⚡ 加入';
            const lockIcon = room.hasPassword ? '🔒 ' : '';

            row.innerHTML = `
                <td><span style="font-family: monospace; color: var(--primary); font-weight: bold;">${room.id}</span></td>
                <td>${room.playersCount} / ${room.maxPlayers}</td>
                <td>${lockIcon}${room.hasPassword ? '私密' : '公开'}</td>
                <td><button class="${buttonClass} join-action-btn" data-room-id="${room.id}" data-has-password="${room.hasPassword}">${buttonText}</button></td>
            `;
            roomListBody.appendChild(row);
        });

        document.querySelectorAll('.join-action-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const targetRoomId = e.target.dataset.roomId;
                const hasPassword = e.target.dataset.hasPassword === 'true';
                const isSpectating = e.target.textContent.includes('观战');
                
                let password = '';
                if (hasPassword) {
                    password = prompt('🔒 该房间需要密码:');
                    if (password === null) return;
                }
                
                if (!currentUser) return alert("请先登录！");

                if (isSpectating) {
                    socket.emit('joinAsSpectator', { 
                        roomId: targetRoomId, 
                        playerName: currentUser.nickname,
                        username: currentUser.username,
                        password: password
                    });
                } else {
                    socket.emit('joinRoom', { 
                        roomId: targetRoomId, 
                        playerName: currentUser.nickname,
                        username: currentUser.username,
                        password: password
                    });
                }
            });
        });
    });

    socket.on('updateLeaderboard', (leaderboardData) => {
        const leaderboardBody = document.getElementById('leaderboard-body');
        if (!leaderboardBody) return;

        leaderboardBody.innerHTML = ''; 

        if (leaderboardData.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">暂无数据</td></tr>`;
            return;
        }

        leaderboardData.forEach((player, index) => {
            const row = document.createElement('tr');
            const onlineStatusClass = player.isOnline ? 'online' : 'offline';
            const rankStyle = index < 3 ? `color: #f59e0b; font-weight: bold;` : `color: #94a3b8;`;
            
            row.innerHTML = `
                <td style="${rankStyle}">#${index + 1}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="online-status ${onlineStatusClass}"></span>
                        <span>${player.nickname}</span>
                    </div>
                </td>
                <td>${Math.floor(player.prestigeScore)}</td>
                <td style="font-size: 0.8rem; color: #64748b;">${player.wins}胜</td>
            `;
            leaderboardBody.appendChild(row);
        });
    });


    socket.on('roomCreated', (data) => {
        roomId = data.roomId;
        myPlayerId = data.myPlayerId;
        dom.roomInfo.textContent = `✅ 房间 ${roomId} 已创建`;
        render(data.gameState);
    });
    
    socket.on('roomJoined', (data) => {
        roomId = data.roomId;
        myPlayerId = data.myPlayerId;
        render(data.gameState);
    });

    socket.on('updateState', async (newState) => {
        if (!newState) {
            if (turnTimerInterval) clearInterval(turnTimerInterval);
            dom.mainContent.classList.add('hidden');
            dom.gameOverModal.classList.add('hidden');
            dom.roomManagement.classList.remove('hidden');
            dom.roomInfo.textContent = '❌ 连接已断开';
            gameState = null;
            roomId = null;
            return;
        }

        const oldState = gameState ? JSON.parse(JSON.stringify(gameState)) : null;
        
        const healthChanges = getHealthChanges(oldState, newState);

        if (healthChanges.length > 0) {
            isAnimating = true;
            const animationPromises = healthChanges.map(change => {
                if (change.type === 'damage' && change.amount > 0) {
                    return playAttackAnimation(change.attackerId, change.targetId, change.amount);
                } else if (change.type === 'heal' && change.amount > 0) {
                    return playHealAnimation(change.targetId, change.amount);
                }
                return Promise.resolve();
            });
            await Promise.all(animationPromises);
            isAnimating = false;
        }

        render(newState);
    });

    socket.on('errorMsg', (message) => {
        alert(message);
    });
    
    socket.on('playVoiceLine', ({ messageKey }) => {
        const messageData = QUICK_CHAT_MESSAGES[messageKey];
        if (messageData) {
            const audio = document.getElementById(messageData.audioId);
            if (audio) {
                audio.currentTime = 0;
                audio.play().catch(e => console.error("音频播放失败:", e));
            }
        }
    });

    // --- 核心渲染与动画函数 ---
    function render(state) {
        const oldGameState = gameState;
        gameState = state;
        dom.roomManagement.classList.add('hidden');
        dom.mainContent.classList.remove('hidden');

        const isSpectator = myPlayerId === null;

        dom.playersContainer.innerHTML = '';
        state.players.forEach(player => {
            const playerCard = document.createElement('div');
            playerCard.className = 'player-card';
            playerCard.dataset.playerId = player.id;
            
            // 样式处理
            if (player.cardBackground) {
                playerCard.style.backgroundImage = `url(${player.cardBackground})`;
            }

            if (player.id === state.currentPlayerIndex && !state.gameOver) playerCard.classList.add('current-turn');
            if (!player.is_alive) playerCard.classList.add('is-dead');
            // 高亮自己
            if (player.id === myPlayerId) {
                // 不需要特殊边框，名字后面加标识即可，保持视觉统一
            }

            const handsHTML = player.hands.map((val, i) => { 
                const itemName = ITEM_MAP[val] || (val === 0 ? ITEM_MAP[0] : '&nbsp;'); 
                return `
                <div class="hand" data-player-id="${player.id}" data-hand-index="${i}">
                    <div class="hand-number">${val}</div>
                    <span class="item-name">${itemName}</span>
                </div>`; 
            }).join('');
            
            const isBotTag = player.isAI ? ' <span style="color: #f59e0b; font-size: 0.8em;">[BOT]</span>' : '';
            const borderClass = player.equippedBorder ? player.equippedBorder : '';
            
            // 构建新的 HTML 结构
            playerCard.innerHTML = `
                <div class="card-border ${borderClass}"></div>
                <div class="performance-score" style="position:absolute; top:10px; right:10px; z-index:4; background:rgba(0,0,0,0.6); padding:2px 8px; border-radius:10px; font-size:0.8rem;">
                    ⭐ ${player.performanceScore || 0}
                </div>
                <div class="player-card-content">
                    <div style="text-shadow: 0 2px 4px #000;">
                        <h3>${player.name}${isBotTag} ${player.id === myPlayerId ? '<span style="color:var(--primary)">(我)</span>' : ''}</h3>
                        <p>HP: ${player.health} / ${player.maxHealth}</p>
                    </div>
                    <div class="player-hands">${handsHTML}</div>
                </div>`;
            dom.playersContainer.appendChild(playerCard);

            // 分数动画
            const oldPlayer = oldGameState?.players.find(p => p.id === player.id);
            if(oldPlayer && player.performanceScore !== oldPlayer.performanceScore) {
                const scoreEl = playerCard.querySelector('.performance-score');
                anime({
                    targets: scoreEl,
                    scale: [1, 1.5, 1],
                    color: ['#fff', '#fbbf24', '#fff'],
                    duration: 500,
                    easing: 'easeOutQuad'
                });
            }
        });

        if (turnTimerInterval) clearInterval(turnTimerInterval);
        dom.turnTimer.classList.add('hidden');

        dom.turnIndicatorText.textContent = state.phase === 'waiting' ? `⏳ 等待玩家加入 (${state.players.length}/${state.maxPlayers})` : (state.gameOver ? "🏆 游戏结束" : `⚔️ 当前回合: ${state.players[state.currentPlayerIndex].name}`);
        
        const wasScrolledToBottom = dom.logList.scrollHeight - dom.logList.clientHeight <= dom.logList.scrollTop + 50;

        dom.logList.innerHTML = state.log.map(entry => {
            let className = '';
            let content = '';

            if (typeof entry === 'string') {
                if (entry.startsWith('[系统]')) className = 'system-message';
                else if (entry.startsWith('[结算]')) className = 'gold-message';
                content = entry;
            } else if (typeof entry === 'object' && entry.type) {
                className = 'chat-message';
                content = `<strong>${entry.sender}:</strong> ${entry.message}`;
            } 
            
            return `<li class="${className}">${content}</li>`;
        }).join('');

        if(wasScrolledToBottom){
            dom.logList.scrollTop = dom.logList.scrollHeight;
        }

        dom.addNumberPanel.classList.add('hidden');
        dom.actionPhasePanel.classList.add('hidden');
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('is-targetable'));
        
        const isMyTurn = !isSpectator && state.players.find(p => p.id === myPlayerId)?.id === state.currentPlayerIndex && !state.gameOver;
        
        if (state.turnStartTime && state.phase !== 'waiting' && !state.gameOver) {
            const TURN_DURATION = 40000;
            dom.turnTimer.classList.remove('hidden');

            const updateTimer = () => {
                const elapsed = Date.now() - state.turnStartTime;
                const remaining = Math.max(0, TURN_DURATION - elapsed);
                const remainingSeconds = (remaining / 1000).toFixed(1);
                dom.turnTimer.textContent = `${remainingSeconds}s`;
                if (remaining <= 0) {
                    clearInterval(turnTimerInterval);
                }
            };
            updateTimer();
            turnTimerInterval = setInterval(updateTimer, 100);
        }

        if (isMyTurn && state.phase === 'addNumber') { dom.addNumberPanel.classList.remove('hidden'); resetSelection(); updateAddNumberUI(); }
        else if (isMyTurn && state.phase === 'action') { dom.actionPhasePanel.classList.remove('hidden'); renderActionButtons(state.possibleActions); }
        else if (isMyTurn && state.phase === 'resolveTntTarget') {
            dom.actionPhasePanel.classList.remove('hidden'); dom.skillButtonsContainer.innerHTML = '';
            dom.actionPhasePrompt.textContent = `💥 TNT触发！请选择受害者...`;
            document.querySelectorAll('.player-card').forEach(card => {
                const cardPlayerId = card.dataset.playerId;
                if(cardPlayerId != state.currentPlayerIndex && state.players.find(p => p.id == cardPlayerId)?.is_alive) card.classList.add('is-targetable');
            });
        }
        
        const isCreator = myPlayerId === 0;
        if (state.phase === 'waiting' && isCreator && state.players.length < state.maxPlayers) {
            dom.waitingActions.classList.remove('hidden');
        } else {
            dom.waitingActions.classList.add('hidden');
        }

        if (state.spectators && state.spectators.length > 0) {
            dom.spectatorBox.classList.remove('hidden');
            dom.spectatorCount.textContent = state.spectators.length;
            dom.spectatorList.innerHTML = state.spectators.map(s => `<li>${s.nickname}</li>`).join('');
        } else {
            dom.spectatorBox.classList.add('hidden');
        }

        if (isSpectator) {
            dom.quickChatBtn.classList.add('hidden');
            dom.chatInput.disabled = false; // 允许观战者打字
        } else {
            dom.quickChatBtn.classList.remove('hidden');
        }

        if (state.gameOver) { 
            dom.winnerText.textContent = `👑 ${state.winner}`; 
            if (state.goldEarned && state.goldEarned[myPlayerId] !== undefined && state.goldEarned[myPlayerId] > 0) {
                dom.goldEarnedText.textContent = `+${state.goldEarned[myPlayerId]} 金币`;
                dom.goldEarnedText.classList.remove('hidden');
            } else {
                dom.goldEarnedText.classList.add('hidden');
            }
            dom.gameOverModal.classList.remove('hidden'); 
        }
        
        if (!isSpectator) {
            addEventListeners();
        }
    }
    
    function renderActionButtons(actions) {
        const container = dom.skillButtonsContainer; container.innerHTML = '';
        if (!actions) return;
        const actionTextMap = { attack_bow: "🏹 弓箭", attack_crossbow: "🏹 强弩", attack_sword: "⚔️ 挥剑", combo_forge: "🔨 锻造", combo_strength: "💪 力量", combo_heal: "💊 治疗", combo_extra_turn: "⚡ 疾跑", combo_life_link: "🔗 链接", combo_reset: "🔄 重置", combo_resurrect: "✝️ 复活" };
        (actions.oneTime || []).forEach(actionObj => { const btn = document.createElement('button'); btn.className = 'skill-btn'; btn.innerHTML = `${actionTextMap[actionObj.action] || actionObj.action}`; btn.dataset.action = actionObj.action; btn.dataset.type = actionObj.type; container.appendChild(btn); });
        (actions.combos || []).forEach(action => { const btn = document.createElement('button'); btn.className = 'combo-btn'; btn.innerHTML = actionTextMap[action] || action; btn.dataset.action = action; btn.dataset.type = 'combo'; container.appendChild(btn); });
        dom.actionPhasePrompt.textContent = `⚡ 技能就绪，请选择`;
    }

    function addEventListeners() {
        document.querySelectorAll('.hand').forEach(hand => hand.onclick = handleAddNumberSelection);
        document.querySelectorAll('#skill-buttons-container button').forEach(btn => btn.onclick = handleActionClick);
        document.querySelectorAll('.player-card').forEach(card => card.onclick = handleTargetSelection);
    }

    function handleAddNumberSelection(e) {
        if (myPlayerId === null) return;
        if (!gameState) return;
        const handElement = e.currentTarget;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        if (isAnimating || !myPlayer || gameState.currentPlayerIndex !== myPlayer.id || gameState.phase !== 'addNumber' || isWaitingForTarget) return;
        
        const { playerId, handIndex } = handElement.dataset;
        const targetPlayer = gameState.players.find(p => p.id == playerId);

        if (playerId == myPlayer.id) {
            selection.attackerHandIndex = parseInt(handIndex);
        } else if (selection.attackerHandIndex !== null && playerId != myPlayer.id) {
            if (!targetPlayer || !targetPlayer.is_alive) return;
            if (targetPlayer.hands[handIndex] == 0) { alert("不能选择对手为0的手牌！"); return; }
            selection.targetPlayerId = parseInt(playerId); 
            selection.targetHandIndex = parseInt(handIndex);
        }
        updateAddNumberUI();
    }
    
    function handleActionClick(e) {
        if (myPlayerId === null) return;
        if (!gameState) return;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        if (isAnimating || !myPlayer || gameState.currentPlayerIndex !== myPlayer.id) return;

        const { type, action } = e.target.dataset;
        const needsTarget = type === 'skill' || ['combo_life_link', 'combo_reset', 'combo_resurrect'].includes(action);
        if (needsTarget) {
            isWaitingForTarget = { type, action };
            dom.actionPhasePrompt.textContent = `🎯 请选择目标...`;
            document.querySelectorAll('.player-card').forEach(card => {
                const cardPlayerId = card.dataset.playerId;
                const targetPlayer = gameState.players.find(p => p.id == cardPlayerId);
                
                if (cardPlayerId != myPlayer.id && targetPlayer) {
                    if (action === 'combo_resurrect') {
                        if (!targetPlayer.is_alive) {
                            card.classList.add('is-targetable');
                        }
                    } else {
                        if (targetPlayer.is_alive) {
                           card.classList.add('is-targetable');
                        }
                    }
                }
            });
        } else {
            socket.emit('playerAction', { roomId, action: 'useAction', payload: { type, action } });
        }
    }
    
    async function handleTargetSelection(e) {
        if (myPlayerId === null) return;
        if (isAnimating || !gameState) return;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        if (!myPlayer || gameState.currentPlayerIndex !== myPlayer.id) return;
        
        const cardElement = e.currentTarget;
        if (!cardElement.classList.contains('is-targetable')) return;

        if (gameState.phase !== 'resolveTntTarget' && !isWaitingForTarget) return;
        
        const targetId = parseInt(e.currentTarget.dataset.playerId);
        if (targetId === myPlayer.id) return;
        
        if (gameState.phase === 'resolveTntTarget') {
            socket.emit('playerAction', { roomId, action: 'resolveTnt', payload: { targetId } });
        } else if (isWaitingForTarget) {
            const { type, action } = isWaitingForTarget;
            isWaitingForTarget = null;
            socket.emit('playerAction', { roomId, action: 'useAction', payload: { type, action, targetId } });
        }
    }
    
    function updateAddNumberUI() {
        if (!gameState) return;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        if (!myPlayer) return;

        document.querySelectorAll('.hand').forEach(h => {
            h.classList.remove('selected-attacker', 'selected-target', 'is-selectable');
            
            const pId = h.dataset.playerId;
            const hIndex = h.dataset.handIndex;
            const p = gameState.players.find(player => player.id == pId);

            if (gameState.currentPlayerIndex === myPlayer.id && gameState.phase === 'addNumber') {
                if (pId == myPlayer.id) {
                    h.classList.add('is-selectable');
                }
                
                if (selection.attackerHandIndex !== null && pId != myPlayer.id && p && p.is_alive && p.hands[hIndex] !== 0) {
                    h.classList.add('is-selectable');
                }
            }
        });

        if (selection.attackerHandIndex !== null) document.querySelector(`.hand[data-player-id="${myPlayer.id}"][data-hand-index="${selection.attackerHandIndex}"]`)?.classList.add('selected-attacker');
        if (selection.targetPlayerId !== null) document.querySelector(`.hand[data-player-id="${selection.targetPlayerId}"][data-hand-index="${selection.targetHandIndex}"]`)?.classList.add('selected-target');
        
        dom.actionPrompt.textContent = selection.attackerHandIndex === null ? "👉 你的回合：选择你的手" : "👉 选择攻击目标";
        dom.confirmAddBtn.disabled = !(selection.attackerHandIndex !== null && selection.targetPlayerId !== null);
    }

    function resetSelection() {
        selection = { attackerHandIndex: null, targetPlayerId: null, targetHandIndex: null };
        isWaitingForTarget = null;
    }

    function getHealthChanges(oldState, newState) {
        if (!oldState || !newState || !oldState.players || !newState.players) return [];
        
        const changes = [];
        for (const newPlayer of newState.players) {
            const oldPlayer = oldState.players.find(p => p.id === newPlayer.id);
            if (oldPlayer) {
                if (newPlayer.health < oldPlayer.health) {
                    changes.push({
                        type: 'damage',
                        targetId: newPlayer.id,
                        amount: oldPlayer.health - newPlayer.health,
                        attackerId: oldState.currentPlayerIndex
                    });
                } else if (newPlayer.health > oldPlayer.health) {
                    changes.push({
                        type: 'heal',
                        targetId: newPlayer.id,
                        amount: newPlayer.health - oldPlayer.health
                    });
                }
            }
        }
        return changes;
    }

    function playAttackAnimation(attackerId, targetId, damage) {
        return new Promise(resolve => {
            const attackerCard = document.querySelector(`.player-card[data-player-id="${attackerId}"]`);
            const targetCard = document.querySelector(`.player-card[data-player-id="${targetId}"]`);
            if (!attackerCard || !targetCard) { resolve(); return; }
            const clone = attackerCard.cloneNode(true);
            clone.classList.add('card-clone');
            clone.style.position = 'fixed'; // 确保克隆体是fixed定位
            clone.style.zIndex = '9999';
            clone.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.8)';
            document.body.appendChild(clone);
            const startRect = attackerCard.getBoundingClientRect();
            const endRect = targetCard.getBoundingClientRect();
            clone.style.left = `${startRect.left}px`; clone.style.top = `${startRect.top}px`;
            clone.style.width = `${startRect.width}px`; clone.style.height = `${startRect.height}px`;
            const targetCenterX = endRect.left + endRect.width / 2;
            const targetCenterY = endRect.top + endRect.height / 2;
            anime({
                targets: clone,
                left: targetCenterX - startRect.width / 2,
                top: targetCenterY - startRect.height / 2,
                scale: [1, 1.2, 0.5],
                opacity: [1, 1, 0],
                rotate: '20deg',
                duration: 500,
                easing: 'easeInBack',
                complete: () => {
                    dom.attackSound.currentTime = 0;
                    dom.attackSound.play();
                    dom.appContainer.classList.add('screen-shake');
                    setTimeout(() => dom.appContainer.classList.remove('screen-shake'), 400);
                    // 伤害数字
                    const damageEl = document.createElement('div');
                    damageEl.className = 'damage-popup';
                    damageEl.textContent = `-${damage.toFixed(1)}`;
                    targetCard.appendChild(damageEl);
                    setTimeout(() => damageEl.remove(), 1200);
                    
                    clone.remove();
                    setTimeout(resolve, 300);
                }
            });
        });
    }

    function playHealAnimation(targetId, healAmount) {
        return new Promise(resolve => {
            const targetCard = document.querySelector(`.player-card[data-player-id="${targetId}"]`);
            if (!targetCard) { resolve(); return; }

            const healEl = document.createElement('div');
            healEl.className = 'heal-popup';
            healEl.textContent = `+${healAmount.toFixed(1)}`;
            targetCard.appendChild(healEl);

            setTimeout(() => healEl.remove(), 1200);
            setTimeout(resolve, 800);
        });
    }
    
    function setupShop() {
        dom.shopBtn.addEventListener('click', () => {
            currentPreview.border = currentUser.equipped.border;
            updateShopPreview();
            renderShopItems();
            dom.shopModal.classList.remove('hidden');
        });

        dom.closeShopBtn.addEventListener('click', () => {
            dom.shopModal.classList.add('hidden');
        });
    }

    function updateShopPreview() {
        dom.previewNickname.textContent = currentUser.nickname;
        if(currentUser.cardBackground) {
            dom.previewCard.style.backgroundImage = `url(${currentUser.cardBackground})`;
        } else {
            dom.previewCard.style.backgroundImage = 'none';
        }
        
        dom.previewBorder.className = 'card-border';
        if (currentPreview.border) {
            dom.previewBorder.classList.add(currentPreview.border);
        }
    }

    function renderShopItems() {
        dom.borderItemsList.innerHTML = '';
        const borderItems = shopItems.borders;

        for (const itemId in borderItems) {
            const item = borderItems[itemId];
            const itemEl = document.createElement('div');
            itemEl.className = 'shop-item';
            itemEl.dataset.itemId = itemId;
            itemEl.dataset.itemType = 'border';

            const isOwned = currentUser.inventory.borders.includes(itemId);
            const isEquipped = currentUser.equipped.border === itemId;

            if (isOwned) itemEl.classList.add('owned');
            if (isEquipped) itemEl.classList.add('equipped');

            let buttonHTML;
            if (isEquipped) {
                buttonHTML = `<button class="btn-secondary btn-sm unequip-btn" data-item-id="${itemId}">已装备</button>`;
            } else if (isOwned) {
                buttonHTML = `<button class="btn-success btn-sm equip-btn" data-item-id="${itemId}">装备</button>`;
            } else {
                buttonHTML = `<button class="btn-warning btn-sm buy-btn" data-item-id="${itemId}">💰 ${item.price}</button>`;
            }

            itemEl.innerHTML = `
                <div class="item-preview-swatch swatch-${itemId}"></div>
                <span style="font-size: 0.8rem; font-weight: bold;">${item.name}</span>
                ${buttonHTML}
            `;
            dom.borderItemsList.appendChild(itemEl);
        }

        dom.borderItemsList.querySelectorAll('.shop-item').forEach(el => {
            el.addEventListener('mouseenter', () => {
                currentPreview.border = el.dataset.itemId;
                updateShopPreview();
            });
            el.addEventListener('mouseleave', () => {
                currentPreview.border = currentUser.equipped.border;
                updateShopPreview();
            });
        });

        dom.borderItemsList.querySelectorAll('.buy-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                if(confirm(`确定要花费 ${borderItems[btn.dataset.itemId].price} 金币购买 ${borderItems[btn.dataset.itemId].name} 吗？`)) {
                    socket.emit('buyItem', { itemId: btn.dataset.itemId, itemType: 'borders' });
                }
            };
        });
        dom.borderItemsList.querySelectorAll('.equip-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('equipItem', { itemId: btn.dataset.itemId, itemType: 'border' });
            };
        });
        dom.borderItemsList.querySelectorAll('.unequip-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                socket.emit('equipItem', { itemId: null, itemType: 'border' });
            };
        });
    }

    function setupGMPanel() {
        dom.gmPanelBtn.addEventListener('click', () => {
            dom.gmModal.classList.remove('hidden');
        });

        dom.closeGmModalBtn.addEventListener('click', () => {
            dom.gmModal.classList.add('hidden');
        });

        dom.gmModifyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const targetUser = document.getElementById('gm-target-user').value;
            const key = document.getElementById('gm-modify-key').value;
            let value = document.getElementById('gm-modify-value').value;

            if (!targetUser) return alert('请输入目标用户名！');
            
            if (key === 'gold') {
                value = parseInt(value, 10);
                if (isNaN(value)) return alert('金币值必须是数字！');
            }

            socket.emit('gm:modifyUser', { targetUser, key, value });
        });

        dom.gmBanForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const targetUser = document.getElementById('gm-ban-user').value;
            if (!targetUser) return alert('请输入要封禁的用户名！');
            if (confirm(`你确定要永久封禁用户 "${targetUser}" 吗？此操作不可逆！`)) {
                socket.emit('gm:banUser', { targetUser });
            }
        });
    }

    // --- 初始按钮和表单绑定 ---
    
    dom.showRegister.addEventListener('click', (e) => {
        e.preventDefault();
        dom.loginView.classList.add('hidden');
        dom.registerView.classList.remove('hidden');
    });

    dom.showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        dom.registerView.classList.add('hidden');
        dom.loginView.classList.remove('hidden');
    });

    dom.loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        if (username && password) {
            socket.emit('login', { username, password });
        }
    });

    dom.registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value.trim();
        const nickname = document.getElementById('register-nickname').value.trim();
        if (username && password && nickname) {
            socket.emit('register', { username, password, nickname });
        }
    });

    dom.logoutBtn.addEventListener('click', () => {
        window.location.reload();
    });

    dom.createRoomBtn.addEventListener('click', () => {
        if (!currentUser) return alert("请先登录！");

        const maxPlayers = dom.maxPlayersSelect.value;
        const password = dom.createRoomPassword.value;

        const initialHealth = parseInt(dom.initialHealth.value);
        const hand1 = parseInt(dom.initialHand1.value);
        const hand2 = parseInt(dom.initialHand2.value);

        if (isNaN(initialHealth) || initialHealth < 1 || initialHealth > 99) {
            return alert('初始血量必须是 1 到 99 之间的数字！');
        }
        if (isNaN(hand1) || hand1 < 0 || hand1 > 9) {
            return alert('第一只手的数字必须是 0 到 9 之间！');
        }
        if (isNaN(hand2) || hand2 < 0 || hand2 > 9) {
            return alert('第二只手的数字必须是 0 到 9 之间！');
        }
        
        socket.emit('createRoom', { 
            playerName: currentUser.nickname, 
            maxPlayers,
            username: currentUser.username,
            password: password,
            initialHealth: initialHealth,
            initialHands: [hand1, hand2],
        });
    });

    dom.addBotBtn.addEventListener('click', () => {
        if(roomId) {
            socket.emit('addBot', { roomId });
        }
    });

    dom.joinRoomBtn.addEventListener('click', () => {
        if (!currentUser) return alert("请先登录！");
        const joinRoomId = dom.roomIdInput.value.trim().toUpperCase();
        if (joinRoomId.length !== 4) return alert("请输入4位房间号！");
        const password = dom.joinRoomPassword.value;
        socket.emit('joinRoom', { 
            roomId: joinRoomId, 
            playerName: currentUser.nickname,
            username: currentUser.username,
            password: password,
        });
    });

    dom.confirmAddBtn.addEventListener('click', () => {
        if (isAnimating) return;
        socket.emit('playerAction', { roomId, action: 'addNumber', payload: selection });
    });

    dom.resetSelectionBtn.addEventListener('click', () => {
        if (isAnimating) return;
        resetSelection();
        updateAddNumberUI();
    });

    dom.endTurnBtn.addEventListener('click', () => {
        if (isAnimating) return;
        isWaitingForTarget = null;
        socket.emit('playerAction', { roomId, action: 'endTurn' });
    });
    
    dom.playAgainBtn.addEventListener('click', () => {
        dom.gameOverModal.classList.add('hidden');
        dom.mainContent.classList.add('hidden');
        dom.roomManagement.classList.remove('hidden');
        dom.roomInfo.textContent = '';
    });

    dom.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = dom.chatInput.value;
        if (message.trim() && roomId) {
            socket.emit('sendMessage', { roomId, message });
            dom.chatInput.value = '';
        }
    });

    function initializeQuickChatPanel() {
        dom.quickChatPanel.innerHTML = '';
        for (const key in QUICK_CHAT_MESSAGES) {
            const item = document.createElement('div');
            item.className = 'quick-chat-item';
            item.textContent = QUICK_CHAT_MESSAGES[key].text;
            item.dataset.messageKey = key;
            dom.quickChatPanel.appendChild(item);
        }
    }

    dom.quickChatBtn.addEventListener('click', () => {
        if (myPlayerId === null) return;
        dom.quickChatPanel.classList.toggle('hidden');
    });

    dom.quickChatPanel.addEventListener('click', (e) => {
        if (myPlayerId === null) return;
        if (e.target.classList.contains('quick-chat-item')) {
            if (dom.quickChatBtn.disabled) {
                return;
            }
            const messageKey = e.target.dataset.messageKey;
            socket.emit('sendQuickChatMessage', { roomId, messageKey });
            dom.quickChatPanel.classList.add('hidden');
            startVoiceCooldown();
        }
    });

    function startVoiceCooldown() {
        let countdown = 10;
        dom.quickChatBtn.disabled = true;
        dom.quickChatBtn.classList.add('cooldown');
        dom.quickChatBtn.textContent = `${countdown}`;
        if (voiceCooldownInterval) clearInterval(voiceCooldownInterval);
        voiceCooldownInterval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                dom.quickChatBtn.textContent = `${countdown}`;
            } else {
                clearInterval(voiceCooldownInterval);
                dom.quickChatBtn.disabled = false;
                dom.quickChatBtn.classList.remove('cooldown');
                dom.quickChatBtn.textContent = '💬';
            }
        }, 1000);
    }
    
    document.addEventListener('click', (e) => {
        if (!dom.chatForm.contains(e.target) && !dom.quickChatPanel.classList.contains('hidden')) {
            dom.quickChatPanel.classList.add('hidden');
        }
    });

    initializeQuickChatPanel();

    dom.showUploadModalBtn.addEventListener('click', () => {
        dom.uploadModal.classList.remove('hidden');
    });

    dom.cancelUploadBtn.addEventListener('click', () => {
        dom.uploadModal.classList.add('hidden');
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        dom.imageToCrop.src = '';
        dom.imageInput.value = '';
    });

    dom.imageInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const reader = new FileReader();
            reader.onload = () => {
                dom.imageToCrop.src = reader.result;
                if (cropper) {
                    cropper.destroy();
                }
                cropper = new Cropper(dom.imageToCrop, {
                    aspectRatio: 200 / 260,
                    viewMode: 1,
                    dragMode: 'move',
                    background: false,
                    autoCropArea: 1,
                });
            };
            reader.readAsDataURL(files[0]);
        }
    });

    dom.confirmUploadBtn.addEventListener('click', () => {
        if (!cropper || !currentUser) {
            return;
        }
        dom.confirmUploadBtn.disabled = true;
        dom.confirmUploadBtn.textContent = 'Wait...';

        cropper.getCroppedCanvas({
            width: 400,
            height: 520,
        }).toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('cardbg', blob, `${currentUser.username}-bg.png`);
            formData.append('username', currentUser.username);

            try {
                const response = await fetch('/upload-background', {
                    method: 'POST',
                    body: formData,
                });
                const result = await response.json();
                
                if (result.success) {
                    alert('背景更换成功！');
                    currentUser.cardBackground = result.filePath;
                    dom.cancelUploadBtn.click();
                } else {
                    alert(`上传失败: ${result.message}`);
                }
            } catch (error) {
                console.error('上传出错:', error);
                alert('上传时发生网络错误。');
            } finally {
                dom.confirmUploadBtn.disabled = false;
                dom.confirmUploadBtn.textContent = '上传';
            }
        });
    });
});