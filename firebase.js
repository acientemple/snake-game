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
