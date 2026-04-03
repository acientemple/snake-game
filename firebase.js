// Firebase 配置
const firebaseConfig = {
    projectId: "snake-game-6e39e",
    databaseURL: "https://snake-game-6e39e-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// 获取数据库引用
const database = firebase.database();

// 是否启用 Firebase（设为 true 则优先使用 Firebase）
window.useFirebase = true;

// 数据操作函数
const FirebaseDB = {
    // 读取所有数据
    async getAll() {
        const snapshot = await database.ref('/').once('value');
        return snapshot.val() || { users: {}, records: [], topRecords: [] };
    },

    // 保存用户
    async saveUser(username, userData) {
        await database.ref('users/' + username).set(userData);
    },

    // 读取用户
    async getUser(username) {
        const snapshot = await database.ref('users/' + username).once('value');
        return snapshot.val();
    },

    // 读取所有用户
    async getAllUsers() {
        const snapshot = await database.ref('users').once('value');
        return snapshot.val() || {};
    },

    // 保存成绩记录
    async saveRecord(record) {
        const recordsRef = database.ref('records');
        const newRecordRef = recordsRef.push();
        await newRecordRef.set(record);
    },

    // 读取所有成绩
    async getAllRecords() {
        const snapshot = await database.ref('records').once('value');
        const records = [];
        snapshot.forEach(child => {
            records.push(child.val());
        });
        return records;
    },

    // 保存最高分记录
    async saveTopRecord(record) {
        const recordsRef = database.ref('topRecords');
        const newRecordRef = recordsRef.push();
        await newRecordRef.set(record);
    },

    // 读取最高分记录
    async getTopRecords() {
        const snapshot = await database.ref('topRecords').once('value');
        const records = [];
        snapshot.forEach(child => {
            records.push(child.val());
        });
        return records;
    },

    // 批量保存（用于初始化）
    async batchSave(data) {
        if (data.users) {
            for (const [key, value] of Object.entries(data.users)) {
                await database.ref('users/' + key).set(value);
            }
        }
        if (data.records) {
            for (const record of data.records) {
                await this.saveRecord(record);
            }
        }
        if (data.topRecords) {
            for (const record of data.topRecords) {
                await this.saveTopRecord(record);
            }
        }
    }
};

// ============================================
// 多人游戏房间系统
// ============================================
const RoomManager = {
    // 创建房间
    async createRoom(hostUsername, settings = {}) {
        const roomRef = database.ref('rooms').push();
        const roomId = roomRef.key;
        const roomData = {
            roomId,
            host: hostUsername,
            players: [hostUsername],
            status: 'waiting',
            settings: {
                gridSize: settings.gridSize || 20,
                speed: settings.speed || 5,
                gameTime: settings.gameTime || 120,
                targetScore: settings.targetScore || 500
            },
            createdAt: Date.now()
        };
        await roomRef.set(roomData);
        return roomId;
    },

    // 加入房间
    async joinRoom(roomId, username) {
        const roomRef = database.ref('rooms/' + roomId);
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();

        if (!room) {
            return { success: false, error: '房间不存在' };
        }
        if (room.players.length >= 4) {
            return { success: false, error: '房间已满' };
        }
        if (room.players.includes(username)) {
            return { success: false, error: '已在房间中' };
        }

        const newPlayers = [...room.players, username];
        await roomRef.update({ players: newPlayers });
        return { success: true };
    },

    // 离开房间
    async leaveRoom(roomId, username) {
        const roomRef = database.ref('rooms/' + roomId);
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();

        if (!room) return { success: false };

        const newPlayers = room.players.filter(p => p !== username);

        if (newPlayers.length === 0) {
            // 删除房间
            await roomRef.remove();
            await database.ref('gameStates/' + roomId).remove();
            return { success: true, roomDeleted: true };
        }

        // 如果房主离开，转移房主
        let updates = { players: newPlayers };
        if (room.host === username) {
            updates.host = newPlayers[0];
        }

        await roomRef.update(updates);
        return { success: true, newHost: newPlayers[0] };
    },

    // 获取房间信息
    async getRoom(roomId) {
        const snapshot = await database.ref('rooms/' + roomId).once('value');
        return snapshot.val();
    },

    // 获取等待中的房间列表
    async getWaitingRooms() {
        const snapshot = await database.ref('rooms').orderByChild('status').equalTo('waiting').once('value');
        const rooms = [];
        snapshot.forEach(child => {
            rooms.push(child.val());
        });
        return rooms;
    },

    // 监听房间列表变化
    onRoomListChange(callback) {
        return database.ref('rooms').orderByChild('status').equalTo('waiting').on('value', snapshot => {
            const rooms = [];
            snapshot.forEach(child => {
                rooms.push(child.val());
            });
            callback(rooms);
        });
    },

    // 监听房间变化
    onRoomChange(roomId, callback) {
        return database.ref('rooms/' + roomId).on('value', snapshot => {
            callback(snapshot.val());
        });
    },

    // 取消房间监听
    offRoomListChange() {
        database.ref('rooms').off();
    },

    offRoomChange(roomId) {
        database.ref('rooms/' + roomId).off();
    },

    // 开始游戏
    async startGame(roomId) {
        await database.ref('rooms/' + roomId).update({ status: 'playing' });
        // 初始化游戏状态
        const room = await this.getRoom(roomId);

        // 蛇的起始位置
        const startPositions = [
            {x: 10, y: 10, direction: {x: 1, y: 0}},
            {x: 30, y: 10, direction: {x: -1, y: 0}},
            {x: 10, y: 18, direction: {x: 1, y: 0}},
            {x: 30, y: 18, direction: {x: -1, y: 0}}
        ];

        const gameState = {
            roomId,
            tick: 0,
            snakes: room.players.map((username, index) => {
                const pos = startPositions[index] || startPositions[0];
                const body = [];
                for (let i = 0; i < 3; i++) {
                    body.push({x: pos.x - i, y: pos.y});
                }
                return {
                    playerId: username,
                    playerIndex: index,
                    body: body,
                    direction: pos.direction,
                    score: 0,
                    alive: true
                };
            }),
            food: null,
            status: 'playing',
            winner: null,
            lastUpdate: Date.now()
        };
        await database.ref('gameStates/' + roomId).set(gameState);
    },

    // 获取游戏状态
    async getGameState(roomId) {
        const snapshot = await database.ref('gameStates/' + roomId).once('value');
        return snapshot.val();
    },

    // 监听游戏状态变化
    onGameStateChange(roomId, callback) {
        return database.ref('gameStates/' + roomId).on('value', snapshot => {
            callback(snapshot.val());
        });
    },

    // 取消游戏状态监听
    offGameStateChange(roomId) {
        database.ref('gameStates/' + roomId).off();
    },

    // 更新玩家方向
    async updatePlayerDirection(roomId, playerId, direction) {
        const room = await this.getGameState(roomId);
        if (!room) return;

        const snakeIndex = room.snakes.findIndex(s => s.playerId === playerId);
        if (snakeIndex !== -1) {
            const updates = {};
            updates['snakes/' + snakeIndex + '/direction'] = direction;
            updates['lastUpdate'] = Date.now();
            await database.ref('gameStates/' + roomId).update(updates);
        }
    },

    // 更新游戏状态（蛇位置等）
    async updateGameState(roomId, gameState) {
        gameState.lastUpdate = Date.now();
        await database.ref('gameStates/' + roomId).update(gameState);
    },

    // 更新食物
    async updateFood(roomId, food) {
        await database.ref('gameStates/' + roomId).update({
            food,
            lastUpdate: Date.now()
        });
    },

    // 结束游戏
    async endGame(roomId, winner = null) {
        await database.ref('rooms/' + roomId).update({ status: 'finished' });
        await database.ref('gameStates/' + roomId).update({
            status: 'finished',
            winner
        });
    },

    // 返回等待大厅
    async returnToLobby(roomId) {
        await database.ref('rooms/' + roomId).update({ status: 'waiting' });
        await database.ref('gameStates/' + roomId).remove();
    }
};
