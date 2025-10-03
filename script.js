document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

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
        roomInfo: document.getElementById('room-info'),
        gameBoard: document.getElementById('game-board'),
        playersContainer: document.getElementById('players-container'),
        turnIndicator: document.getElementById('turn-indicator'),
        turnIndicatorText: document.getElementById('turn-indicator-text'),
        turnTimer: document.getElementById('turn-timer'),
        logList: document.getElementById('log-list'),
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

        createRoomPassword: document.getElementById('create-room-password'),
        joinRoomPassword: document.getElementById('join-room-password'),
        roomListBody: document.getElementById('room-list-body'),

        initialHealth: document.getElementById('initial-health'),
        initialHand1: document.getElementById('initial-hand-1'),
        initialHand2: document.getElementById('initial-hand-2'),
    };
    
    const ITEM_MAP = { 3: '箭矢x1', 4: '盾牌', 5: '剑', 6: '箭矢x2', 7: '弓', 8: '弩', 9: '药水', 0: 'TNT' };
    
    let gameState = null;
    let myPlayerId = null;
    let roomId = null;
    let selection = { attackerHandIndex: null, targetPlayerId: null, targetHandIndex: null };
    let isWaitingForTarget = null;
    let isAnimating = false;
    let currentUser = null;
    let cropper = null;
    let turnTimerInterval = null;

    // --- 认证 Socket 事件监听 ---
    socket.on('loginSuccess', (user) => {
        currentUser = user;
        dom.authContainer.classList.add('hidden');
        dom.roomManagement.classList.remove('hidden');
        updateProfileUI();
    });

    socket.on('loginError', (message) => alert(`登录失败: ${message}`));
    socket.on('registerSuccess', (message) => {
        alert(message);
        dom.registerView.classList.add('hidden');
        dom.loginView.classList.remove('hidden');
    });
    socket.on('registerError', (message) => alert(`注册失败: ${message}`));
    socket.on('updateStats', (newStats) => {
        if (currentUser) {
            currentUser.stats = newStats;
            updateProfileUI();
        }
    });

    function updateProfileUI() {
        if(currentUser) {
            dom.profileNickname.textContent = currentUser.nickname;
            dom.profileStats.textContent = `${currentUser.stats.wins} 胜 / ${currentUser.stats.gamesPlayed} 场`;
        }
    }


    // --- 游戏 Socket 事件监听 ---
    socket.on('updateLobby', (rooms) => {
        const roomListBody = dom.roomListBody;
        if (!roomListBody) return;

        roomListBody.innerHTML = '';
        if (rooms.length === 0) {
            roomListBody.innerHTML = `<tr><td colspan="4">当前没有开放的房间</td></tr>`;
            return;
        }

        rooms.forEach(room => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${room.id}</td>
                <td>${room.playersCount} / ${room.maxPlayers}</td>
                <td>${room.hasPassword ? '🔒' : '公开'}</td>
                <td><button class="join-lobby-btn" data-room-id="${room.id}" data-has-password="${room.hasPassword}">加入</button></td>
            `;
            roomListBody.appendChild(row);
        });

        document.querySelectorAll('.join-lobby-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const targetRoomId = e.target.dataset.roomId;
                const hasPassword = e.target.dataset.hasPassword === 'true';
                let password = '';

                if (hasPassword) {
                    password = prompt('该房间受密码保护，请输入密码:');
                    if (password === null) return;
                }
                
                if (!currentUser) return alert("请先登录！");

                socket.emit('joinRoom', { 
                    roomId: targetRoomId, 
                    playerName: currentUser.nickname,
                    username: currentUser.username,
                    password: password
                });
            });
        });
    });

    socket.on('updateLeaderboard', (leaderboardData) => {
        const leaderboardBody = document.getElementById('leaderboard-body');
        if (!leaderboardBody) return;

        leaderboardBody.innerHTML = ''; 

        if (leaderboardData.length === 0) {
            leaderboardBody.innerHTML = `<tr><td colspan="4">暂无玩家数据</td></tr>`;
            return;
        }

        leaderboardData.forEach((player, index) => {
            const row = document.createElement('tr');
            const onlineStatusClass = player.isOnline ? 'online' : 'offline';
            const onlineStatusText = player.isOnline ? '在线' : '离线';
            const cardPreviewStyle = player.cardBackground ? `style="background-image: url(${player.cardBackground})"` : '';

            row.innerHTML = `
                <td>#${index + 1}</td>
                <td>
                    <div class="leaderboard-player-cell">
                        <div class="leaderboard-card-preview" ${cardPreviewStyle}></div>
                        <span>${player.nickname}</span>
                    </div>
                </td>
                <td>${player.winRate.toFixed(1)}%</td>
                <td>
                    <span class="online-status ${onlineStatusClass}"></span>
                    ${onlineStatusText}
                </td>
            `;
            leaderboardBody.appendChild(row);
        });
    });


    socket.on('roomCreated', (data) => {
        roomId = data.roomId;
        myPlayerId = data.myPlayerId;
        dom.roomInfo.textContent = `房间创建成功！房号: ${roomId}，等待其他玩家...`;
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
            dom.roomInfo.textContent = '游戏已结束或房主已离开。';
            gameState = null;
            roomId = null;
            return;
        }
        const oldState = gameState ? JSON.parse(JSON.stringify(gameState)) : null;
        const attackInfo = getAttackInfo(oldState, newState);
        if (attackInfo && attackInfo.damage > 0) {
            isAnimating = true;
            await playAttackAnimation(attackInfo.attackerId, attackInfo.targetId, attackInfo.damage);
            isAnimating = false;
        }
        render(newState);
    });

    socket.on('errorMsg', (message) => {
        alert(message);
    });
    
    // --- 核心渲染与动画函数 ---
    function render(state) {
        gameState = state;
        dom.roomManagement.classList.add('hidden');
        dom.mainContent.classList.remove('hidden');

        dom.playersContainer.innerHTML = '';
        state.players.forEach(player => {
            const playerCard = document.createElement('div');
            playerCard.className = 'player-card';
            playerCard.dataset.playerId = player.id;
            
            if (player.cardBackground) {
                playerCard.style.backgroundImage = `url(${player.cardBackground})`;
            }

            if (player.id === state.currentPlayerIndex && !state.gameOver) playerCard.classList.add('current-turn');
            if (!player.is_alive) playerCard.classList.add('is-dead');
            if (player.id === myPlayerId) playerCard.style.borderColor = '#007bff';

            const handsHTML = player.hands.map((val, i) => { const itemName = ITEM_MAP[val] || (val === 0 ? ITEM_MAP[0] : '&nbsp;'); return `<div class="hand" data-player-id="${player.id}" data-hand-index="${i}"><div class="hand-number">${val}</div><span class="item-name">${itemName}</span></div>`; }).join('');
            playerCard.innerHTML = `<div class="player-card-content"><h3>${player.name} ${player.id === myPlayerId ? '(你)' : ''}</h3><p>❤️ HP: ${player.health} / ${player.maxHealth}</p><div class="player-hands">${handsHTML}</div></div>`;
            dom.playersContainer.appendChild(playerCard);
        });

        if (turnTimerInterval) clearInterval(turnTimerInterval);
        dom.turnTimer.classList.add('hidden');

        dom.turnIndicatorText.textContent = state.phase === 'waiting' ? `等待玩家加入... (${state.players.length}/${state.maxPlayers})` : (state.gameOver ? "游戏已结束" : `当前回合: ${state.players[state.currentPlayerIndex].name}`);
        
        const wasScrolledToBottom = dom.logList.scrollHeight - dom.logList.clientHeight <= dom.logList.scrollTop + 1;

        dom.logList.innerHTML = state.log.map(entry => {
            if (entry.startsWith('[系统]')) {
                const li = document.createElement('li');
                li.className = 'system-message';
                li.innerText = entry;
                return li.outerHTML;
            } else if (entry.includes(': ')) {
                const parts = entry.split(': ');
                const playerName = parts.shift();
                const message = parts.join(': ');
                const li = document.createElement('li');
                li.className = 'chat-message';
                const strong = document.createElement('strong');
                strong.innerText = `${playerName}:`;
                li.appendChild(strong);
                const messageNode = document.createTextNode(` ${message}`);
                li.appendChild(messageNode);
                return li.outerHTML;
            } else {
                 const li = document.createElement('li');
                 li.innerText = entry;
                 return li.outerHTML;
            }
        }).join('');

        if(wasScrolledToBottom){
            dom.logList.scrollTop = dom.logList.scrollHeight;
        }

        dom.addNumberPanel.classList.add('hidden');
        dom.actionPhasePanel.classList.add('hidden');
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('is-targetable'));
        
        const isMyTurn = state.players.find(p => p.id === myPlayerId)?.id === state.currentPlayerIndex && !state.gameOver;
        
        if (state.turnStartTime && state.phase !== 'waiting' && !state.gameOver) {
            const TURN_DURATION = 40000;
            dom.turnTimer.classList.remove('hidden');

            const updateTimer = () => {
                const elapsed = Date.now() - state.turnStartTime;
                const remaining = Math.max(0, TURN_DURATION - elapsed);
                const remainingSeconds = (remaining / 1000).toFixed(1);
                dom.turnTimer.textContent = `(${remainingSeconds}s)`;
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
            dom.actionPhasePrompt.textContent = `TNT触发！请选择一个目标玩家...`;
            document.querySelectorAll('.player-card').forEach(card => {
                const cardPlayerId = card.dataset.playerId;
                if(cardPlayerId != state.currentPlayerIndex && state.players.find(p => p.id == cardPlayerId)?.is_alive) card.classList.add('is-targetable');
            });
        }

        if (state.gameOver) { dom.winnerText.textContent = `胜利者是 ${state.winner}！`; dom.gameOverModal.classList.remove('hidden'); }
        addEventListeners();
    }
    
    function renderActionButtons(actions) {
        const container = dom.skillButtonsContainer; container.innerHTML = '';
        if (!actions) return;
        const actionTextMap = { attack_bow: "攻击：弓", attack_crossbow: "攻击：弩", attack_sword: "攻击：剑", combo_forge: "组合：锻造", combo_strength: "力量药水", combo_heal: "强效治疗", combo_extra_turn: "额外回合", combo_life_link: "生命链接", combo_reset: "重置", combo_resurrect: "组合：复活" };
        (actions.oneTime || []).forEach(actionObj => { const btn = document.createElement('button'); btn.className = 'skill-btn'; btn.textContent = `${actionTextMap[actionObj.action]} (1次性)`; btn.dataset.action = actionObj.action; btn.dataset.type = actionObj.type; container.appendChild(btn); });
        (actions.combos || []).forEach(action => { const btn = document.createElement('button'); btn.className = 'combo-btn'; btn.textContent = actionTextMap[action]; btn.dataset.action = action; btn.dataset.type = 'combo'; container.appendChild(btn); });
        dom.actionPhasePrompt.textContent = `请选择要发动的技能，或结束回合。`;
    }

    function addEventListeners() {
        document.querySelectorAll('.hand').forEach(hand => hand.onclick = handleAddNumberSelection);
        document.querySelectorAll('#skill-buttons-container button').forEach(btn => btn.onclick = handleActionClick);
        document.querySelectorAll('.player-card').forEach(card => card.onclick = handleTargetSelection);
    }

    function handleAddNumberSelection(e) {
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
        if (!gameState) return;
        const myPlayer = gameState.players.find(p => p.id === myPlayerId);
        if (isAnimating || !myPlayer || gameState.currentPlayerIndex !== myPlayer.id) return;

        const { type, action } = e.target.dataset;
        const needsTarget = type === 'skill' || ['combo_life_link', 'combo_reset', 'combo_resurrect'].includes(action);
        if (needsTarget) {
            isWaitingForTarget = { type, action };
            dom.actionPhasePrompt.textContent = `请为 [${e.target.textContent}] 选择一个目标玩家...`;
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
        
        dom.actionPrompt.textContent = selection.attackerHandIndex === null ? "请选择你自己的手..." : "请选择对手的手...";
        dom.confirmAddBtn.disabled = !(selection.attackerHandIndex !== null && selection.targetPlayerId !== null);
    }

    function resetSelection() {
        selection = { attackerHandIndex: null, targetPlayerId: null, targetHandIndex: null };
        isWaitingForTarget = null;
    }

    function getAttackInfo(oldState, newState) {
        if (!oldState || !newState || !oldState.players || !newState.players) return null;
        for (const newPlayer of newState.players) {
            const oldPlayer = oldState.players.find(p => p.id === newPlayer.id);
            if (oldPlayer && newPlayer.health < oldPlayer.health) {
                return { attackerId: oldState.currentPlayerIndex, targetId: newPlayer.id, damage: oldPlayer.health - newPlayer.health };
            }
        }
        return null;
    }

    function playAttackAnimation(attackerId, targetId, damage) {
        return new Promise(resolve => {
            const attackerCard = document.querySelector(`.player-card[data-player-id="${attackerId}"]`);
            const targetCard = document.querySelector(`.player-card[data-player-id="${targetId}"]`);
            if (!attackerCard || !targetCard) { resolve(); return; }
            const clone = attackerCard.cloneNode(true);
            clone.classList.add('card-clone');
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
                scale: [1, 1.2, 0.8],
                rotate: '1turn',
                duration: 600,
                easing: 'easeInQuad',
                complete: () => {
                    dom.attackSound.currentTime = 0;
                    dom.attackSound.play();
                    dom.appContainer.classList.add('screen-shake');
                    setTimeout(() => dom.appContainer.classList.remove('screen-shake'), 400);
                    createParticles(targetCenterX, targetCenterY);
                    const damageEl = document.createElement('span');
                    damageEl.className = 'damage-popup';
                    damageEl.textContent = `-${damage.toFixed(1)}`;
                    targetCard.appendChild(damageEl);
                    setTimeout(() => damageEl.remove(), 1200);
                    clone.remove();
                    setTimeout(resolve, 600);
                }
            });
        });
    }

    function createParticles(x, y) {
        for (let i = 0; i < 20; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            document.body.appendChild(particle);
            anime({ targets: particle, left: x, top: y, width: [anime.random(5, 15), 0], height: [anime.random(5, 15), 0], translateX: anime.random(-80, 80), translateY: anime.random(-80, 80), opacity: [1, 0], duration: anime.random(800, 1200), easing: 'easeOutExpo', complete: () => particle.remove() });
        }
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

    // +++ 修复核心：在点击“结束回合”时，主动清除“等待选择目标”的状态 +++
    dom.endTurnBtn.addEventListener('click', () => {
        if (isAnimating) return;
        isWaitingForTarget = null; // 关键！在这里清除幽灵状态
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
        dom.confirmUploadBtn.textContent = '上传中...';

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
                dom.confirmUploadBtn.textContent = '确认上传';
            }
        });
    });
});