// 贪吃蛇游戏核心逻辑 - 增强版

// 简单的哈希函数
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

// EmailJS 配置 - 从 localStorage 加载
function getEmailJSConfig() {
    const config = localStorage.getItem('snake-emailjs-config');
    return config ? JSON.parse(config) : null;
}

const EMAILJS_CONFIG = getEmailJSConfig() || {
    publicKey: '',
    serviceId: '',
    templateId: ''
};

// 用户认证系统
class AuthSystem {
    constructor() {
        this.currentUser = null;
        this.users = this.loadUsers();
        this.emailEnabled = false;
    }

    // 获取有效的 GitHub Token（优先用户自己的，备选共享的）
    getGitHubToken() {
        // 优先使用用户自己的 Token
        let token = localStorage.getItem('snake-github-token');
        if (!token) {
            // 使用共享 Token
            token = localStorage.getItem('snake-shared-github-token');
        }
        // 如果还是没有，使用临时Token并异步获取真正的共享Token
        if (!token) {
            // 临时使用默认Token
            const encoded = 'Z2hwX3R3THpJSExRQ01jTU9Sa1hNUHhmYlJnM004eG91STMxcFYxeQ==';
            token = atob(encoded);
            // 异步更新共享Token
            this.updateSharedTokenFromGitHub();
        }
        return token;
    }

    // 从GitHub更新共享Token
    async updateSharedTokenFromGitHub() {
        // 临时Token
        const encoded = 'Z2hwX3R3THpJSExRQ01jTU9Sa1hNUHhmYlJnM004eG91STMxcFYxeQ==';
        const tempToken = atob(encoded);

        try {
            const listResponse = await fetch('https://api.github.com/gists', {
                headers: {
                    'Authorization': `token ${tempToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (listResponse.ok) {
                const gists = await listResponse.json();
                const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                if (existingGist) {
                    localStorage.setItem('snake-users-gist-id', existingGist.id);
                    const gistResponse = await fetch(`https://api.github.com/gists/${existingGist.id}`, {
                        headers: {
                            'Authorization': `token ${tempToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (gistResponse.ok) {
                        const gist = await gistResponse.json();
                        const config = gist.files['snake-config.json']?.content;
                        if (config) {
                            const configData = JSON.parse(config);
                            if (configData.sharedToken) {
                                localStorage.setItem('snake-shared-github-token', configData.sharedToken);
                                localStorage.setItem('snake-shared-github-user', configData.sharedUser);
                                console.log('已从GitHub更新共享Token');
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.log('更新共享Token失败', e);
        }
    }

    // 初始化方法，在 DOM 加载完成后调用
    async initAuth() {
        // 如果有 GitHub Token（用户自己的或共享的），强制从 GitHub 加载最新用户数据
        const githubToken = this.getGitHubToken();
        if (githubToken) {
            this.users = this.loadUsers();
            // 页面加载时也尝试从 GitHub 加载最新用户数据
            await this.refreshUsers();
        }

        // 检查是否已登录
        if (this.isLoggedIn()) {
            console.log('已自动登录: ' + this.currentUser);
        }

        // 显示共享 Token 状态
        const sharedToken = localStorage.getItem('snake-shared-github-token');
        const sharedUser = localStorage.getItem('snake-shared-github-user');
        if (sharedToken && sharedUser) {
            const statusEl = document.getElementById('shared-token-status');
            if (statusEl) {
                statusEl.textContent = '✓ 共享 Token 已设置，当前用户: ' + sharedUser;
                statusEl.style.color = 'green';
            }
        } else {
            // 如果没有共享 Token，显示提示
            const loginHint = document.getElementById('login-hint');
            if (loginHint) {
                loginHint.style.display = 'block';
            }
        }

        this.init();
    }

    // 强制刷新用户数据（从 GitHub）
    async refreshUsers() {
        const githubToken = this.getGitHubToken();
        if (githubToken) {
            // 异步从 GitHub 加载
            const users = await this.loadUsersFromGitHub(githubToken, null);
            if (users && Object.keys(users).length > 0) {
                this.users = users;
                localStorage.setItem('snake-users', JSON.stringify(users));
                console.log('已刷新GitHub用户数据, 用户数:', Object.keys(users).length);
            }
        }
    }

    // 从GitHub同步记录到本地（保存后立即调用）
    async syncRecordsFromGitHub() {
        const githubToken = this.getGitHubToken();
        if (!githubToken) {
            console.log('syncRecordsFromGitHub: 没有GitHub Token');
            return;
        }

        console.log('syncRecordsFromGitHub: 开始同步...');
        try {
            let gistId = localStorage.getItem('snake-users-gist-id');

            // 如果没有gistId，先查找
            if (!gistId) {
                const listResponse = await fetch('https://api.github.com/gists', {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (listResponse.ok) {
                    const gists = await listResponse.json();
                    const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                    if (existingGist) {
                        gistId = existingGist.id;
                        localStorage.setItem('snake-users-gist-id', gistId);
                    }
                }
            }

            if (!gistId) return;

            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.ok) {
                const gist = await response.json();
                const records = gist.files['snake-records.json']?.content || '[]';
                const topRecords = gist.files['snake-top-records.json']?.content || '[]';

                // 更新本地存储
                localStorage.setItem('snake-records', records);
                localStorage.setItem('snake-top-records', topRecords);

                console.log('已从GitHub同步记录到本地，记录数:', JSON.parse(records).length);

                // 更新游戏显示
                if (window.game) {
                    window.game.displayRecords();
                }
            }
        } catch (e) {
            console.log('同步记录失败', e);
        }
    }

    // 初始化 EmailJS
    initEmailJS() {
        const config = getEmailJSConfig();
        if (!config || !config.publicKey) {
            console.warn('EmailJS 未配置');
            return false;
        }
        if (typeof emailjs === 'undefined') {
            console.warn('EmailJS SDK 未加载');
            return false;
        }
        try {
            emailjs.init(config.publicKey);
            this.emailEnabled = true;
            return true;
        } catch (e) {
            console.error('EmailJS 初始化失败:', e);
            return false;
        }
    }

    loadEmailConfig() {
        const config = getEmailJSConfig();
        if (config) {
            document.getElementById('emailjs-public-key').value = config.publicKey || '';
            document.getElementById('emailjs-service-id').value = config.serviceId || '';
            document.getElementById('emailjs-template-id').value = config.templateId || '';
            if (config.publicKey) {
                document.getElementById('email-config-status').innerHTML = '<span style="color:green;">✓ 已配置 EmailJS</span>';
            }
        }
    }

    // 发送密码重置邮件
    async sendPasswordResetEmail(email, username, resetLink) {
        const config = getEmailJSConfig();
        if (!config || !config.publicKey || typeof emailjs === 'undefined') {
            // 如果未配置，显示链接
            document.getElementById('reset-link').textContent = resetLink;
            return true;
        }

        try {
            const response = await emailjs.send(config.serviceId, config.templateId, {
                to_email: email,
                to_name: username,
                reset_link: resetLink,
                from_name: '贪吃蛇游戏'
            });
            console.log('邮件发送成功:', response);
            return true;
        } catch (error) {
            console.error('邮件发送失败:', error);
            // 失败时显示链接作为备选
            document.getElementById('reset-link').textContent = resetLink;
            return false;
        }
    }

    loadUsers() {
        // 优先从 GitHub 加载（如果已配置）
        const githubToken = this.getGitHubToken();

        // 同步版本：先从本地加载
        const users = localStorage.getItem('snake-users');
        const localUsers = users ? JSON.parse(users) : {};

        // 如果有 GitHub Token，尝试从 GitHub 异步加载
        if (githubToken) {
            this.loadUsersFromGitHub(githubToken, null).then(cloudUsers => {
                if (cloudUsers && Object.keys(cloudUsers).length > 0) {
                    this.users = cloudUsers;
                    localStorage.setItem('snake-users', JSON.stringify(cloudUsers));
                    console.log('已从GitHub同步用户数据, 用户数:', Object.keys(cloudUsers).length);
                }
            }).catch(() => {
                console.log('从GitHub加载失败，使用本地数据');
            });
        }

        return localUsers;
    }

    // 从 GitHub 加载用户数据
    async loadUsersFromGitHub(token, gistId) {
        try {
            let targetGistId = gistId;

            // 如果没有gistId，尝试查找
            if (!targetGistId) {
                const listResponse = await fetch('https://api.github.com/gists', {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (listResponse.ok) {
                    const gists = await listResponse.json();
                    const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                    if (existingGist) {
                        targetGistId = existingGist.id;
                        localStorage.setItem('snake-users-gist-id', targetGistId);
                    }
                }
            }

            if (!targetGistId) return null;

            const response = await fetch(`https://api.github.com/gists/${targetGistId}`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            if (response.ok) {
                const gist = await response.json();
                const content = gist.files['snake-users.json']?.content;

                // 同时加载游戏记录
                const records = gist.files['snake-records.json']?.content || '[]';
                const topRecords = gist.files['snake-top-records.json']?.content || '[]';

                // 保存到 localStorage
                localStorage.setItem('snake-records', records);
                localStorage.setItem('snake-top-records', topRecords);
                console.log('从GitHub加载记录:', JSON.parse(records).length, '条');

                // 如果有游戏实例，立即刷新显示
                if (window.game) {
                    window.game.displayRecords();
                }

                if (content) {
                    return JSON.parse(content);
                }
            }
        } catch (e) {
            console.log('从GitHub加载用户失败', e);
        }
        return null;
    }

    // 保存用户数据到 GitHub
    async saveUsersToGitHub() {
        const token = localStorage.getItem('snake-github-token');
        if (!token) return false;

        try {
            // 先查找是否已有"Snake Game Users Data"的Gist
            const listResponse = await fetch('https://api.github.com/gists', {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            let existingGistId = null;
            if (listResponse.ok) {
                const gists = await listResponse.json();
                const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                if (existingGist) {
                    existingGistId = existingGist.id;
                }
            }

            const gistData = {
                description: 'Snake Game Users Data',
                public: false,
                files: {
                    'snake-users.json': {
                        content: JSON.stringify(this.users, null, 2)
                    }
                }
            };

            let url = 'https://api.github.com/gists';
            let method = 'POST';

            if (existingGistId) {
                url += `/${existingGistId}`;
                method = 'PATCH';
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });

            if (response.ok) {
                const gist = await response.json();
                localStorage.setItem('snake-users-gist-id', gist.id);
                console.log('用户数据已保存到GitHub');
                return true;
            }
        } catch (e) {
            console.log('保存到GitHub失败', e);
        }
        return false;
    }

    saveUsers() {
        // 保存到本地
        localStorage.setItem('snake-users', JSON.stringify(this.users));

        // 获取游戏记录
        const records = localStorage.getItem('snake-records') || '[]';
        const topRecords = localStorage.getItem('snake-top-records') || '[]';

        // 尝试同步到 GitHub（同时保存用户和记录）
        return this.saveDataToGitHub(this.users, records, topRecords);
    }

    // 统一保存数据到 GitHub
    async saveDataToGitHub(users, records, topRecords) {
        const githubToken = this.getGitHubToken();
        if (!githubToken) {
            console.log('saveDataToGitHub: 没有GitHub Token，不保存');
            return;
        }

        console.log('saveDataToGitHub: 开始保存...');
        try {
            // 查找现有 Gist
            const listResponse = await fetch('https://api.github.com/gists', {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            let existingGistId = null;
            let cloudUsers = users;
            let cloudRecords = records;
            let cloudTopRecords = topRecords;

            if (listResponse.ok) {
                const gists = await listResponse.json();
                const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                if (existingGist) {
                    existingGistId = existingGist.id;

                    // 获取现有Gist的内容
                    const gistResponse = await fetch(`https://api.github.com/gists/${existingGistId}`, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (gistResponse.ok) {
                        const gist = await gistResponse.json();

                        // 获取云端的用户数据
                        const cloudUsersContent = gist.files['snake-users.json']?.content;
                        if (cloudUsersContent) {
                            cloudUsers = JSON.parse(cloudUsersContent);
                            // 合并用户数据（以本地为主，更新用户信息）
                            Object.assign(cloudUsers, users);
                        }

                        // 获取云端的记录
                        const cloudRecordsContent = gist.files['snake-records.json']?.content;
                        if (cloudRecordsContent) {
                            const cloudRecordsArray = JSON.parse(cloudRecordsContent);
                            const localRecordsArray = JSON.parse(records);
                            // 合并记录（去重）
                            const allRecords = [...cloudRecordsArray, ...localRecordsArray];
                            const uniqueRecords = [];
                            allRecords.forEach(r => {
                                if (!uniqueRecords.find(ur => ur.score === r.score && ur.date === r.date)) {
                                    uniqueRecords.push(r);
                                }
                            });
                            uniqueRecords.sort((a, b) => b.score - a.score);
                            cloudRecords = JSON.stringify(uniqueRecords.slice(0, 50));
                        }

                        // 获取云端的最高分记录
                        const cloudTopRecordsContent = gist.files['snake-top-records.json']?.content;
                        if (cloudTopRecordsContent) {
                            const cloudTopArray = JSON.parse(cloudTopRecordsContent);
                            const localTopArray = JSON.parse(topRecords);
                            const allTop = [...cloudTopArray, ...localTopArray];
                            const uniqueTop = [];
                            allTop.forEach(r => {
                                if (!uniqueTop.find(ur => ur.score === r.score && ur.date === r.date)) {
                                    uniqueTop.push(r);
                                }
                            });
                            uniqueTop.sort((a, b) => b.score - a.score);
                            cloudTopRecords = JSON.stringify(uniqueTop);
                        }
                    }
                }
            }

            const gistData = {
                description: 'Snake Game Users Data',
                public: false,
                files: {
                    'snake-users.json': {
                        content: JSON.stringify(cloudUsers, null, 2)
                    },
                    'snake-records.json': {
                        content: cloudRecords
                    },
                    'snake-top-records.json': {
                        content: cloudTopRecords
                    }
                }
            };

            let url = 'https://api.github.com/gists';
            let method = 'POST';

            if (existingGistId) {
                url += `/${existingGistId}`;
                method = 'PATCH';
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });

            if (response.ok) {
                const gist = await response.json();
                localStorage.setItem('snake-users-gist-id', gist.id);
                console.log('用户和游戏记录已保存到GitHub');
                console.log('保存的记录数:', JSON.parse(cloudRecords).length);
            }
        } catch (e) {
            console.log('保存到GitHub失败', e);
        }
    }

    register(username, password, email = '') {
        if (!username || !password) {
            return { success: false, message: '用户名和密码不能为空' };
        }
        if (this.users[username]) {
            return { success: false, message: '用户名已存在' };
        }
        if (password.length < 3) {
            return { success: false, message: '密码至少3位' };
        }
        // 检查邮箱是否已被使用
        if (email) {
            for (const u in this.users) {
                if (this.users[u].email === email) {
                    return { success: false, message: '该邮箱已被使用' };
                }
            }
        }
        this.users[username] = {
            password: simpleHash(password),
            email: email,
            created: new Date().toISOString(),
            data: {}
        };
        this.saveUsers();
        return { success: true, message: '注册成功' };
    }

    // 忘记密码 - 通过邮箱重置
    resetPassword(username, email, newPassword) {
        const user = this.users[username];
        if (!user) {
            return { success: false, message: '用户不存在' };
        }
        if (user.email !== email) {
            return { success: false, message: '用户名与邮箱不匹配' };
        }
        if (newPassword.length < 3) {
            return { success: false, message: '密码至少3位' };
        }
        user.password = simpleHash(newPassword);
        this.saveUsers();
        return { success: true, message: '密码重置成功' };
    }

    // 管理员重置用户密码
    adminResetPassword(username, newPassword) {
        if (!this.isAdmin) {
            return { success: false, message: '无权限' };
        }
        if (!this.users[username]) {
            return { success: false, message: '用户不存在' };
        }
        if (newPassword.length < 3) {
            return { success: false, message: '密码至少3位' };
        }
        this.users[username].password = simpleHash(newPassword);
        this.saveUsers();
        return { success: true, message: '密码已重置' };
    }

    // 管理员删除用户
    adminDeleteUser(username) {
        if (!this.isAdmin) {
            return { success: false, message: '无权限' };
        }
        if (!this.users[username]) {
            return { success: false, message: '用户不存在' };
        }
        delete this.users[username];
        this.saveUsers();
        return { success: true, message: '用户已删除' };
    }

    // 管理员查看用户数据
    adminGetUserData(username) {
        if (!this.isAdmin) {
            return null;
        }
        return this.users[username] || null;
    }

    // 登录用户修改自己的密码
    changePassword(oldPassword, newPassword) {
        const username = this.currentUser;
        const user = this.users[username];

        if (!user) {
            return { success: false, message: '用户不存在' };
        }

        if (user.password !== simpleHash(oldPassword)) {
            return { success: false, message: '原密码错误' };
        }

        if (newPassword.length < 3) {
            return { success: false, message: '新密码至少3位' };
        }

        user.password = simpleHash(newPassword);
        this.saveUsers();
        return { success: true, message: '密码修改成功' };
    }

    // 显示修改密码对话框
    showChangePasswordDialog() {
        const dialog = document.createElement('div');
        dialog.id = 'change-password-dialog';
        dialog.className = 'modal show';
        dialog.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                <h3>修改密码</h3>
                <input type="password" id="old-password" placeholder="原密码" style="width:100%;padding:12px;margin:10px 0;border:2px solid #ddd;border-radius:8px;">
                <input type="password" id="new-password-change" placeholder="新密码（至少3位）" style="width:100%;padding:12px;margin:10px 0;border:2px solid #ddd;border-radius:8px;">
                <input type="password" id="new-password-confirm" placeholder="确认新密码" style="width:100%;padding:12px;margin:10px 0;border:2px solid #ddd;border-radius:8px;">
                <button id="confirm-change-pass" class="auth-btn">确认修改</button>
            </div>
        `;

        document.body.appendChild(dialog);

        document.getElementById('confirm-change-pass').addEventListener('click', () => {
            const oldPass = document.getElementById('old-password').value;
            const newPass = document.getElementById('new-password-change').value;
            const confirmPass = document.getElementById('new-password-confirm').value;

            if (newPass !== confirmPass) {
                alert('两次输入的新密码不一致');
                return;
            }

            const result = this.changePassword(oldPass, newPass);
            if (result.success) {
                alert('密码修改成功！');
                dialog.remove();
            } else {
                alert(result.message);
            }
        });
    }

    login(username, password) {
        const user = this.users[username];
        if (!user) {
            return { success: false, message: '用户不存在' };
        }
        if (user.password !== simpleHash(password)) {
            return { success: false, message: '密码错误' };
        }
        this.currentUser = username;
        localStorage.setItem('snake-current-user', username);
        return { success: true, message: '登录成功' };
    }

    logout() {
        this.currentUser = null;
        this.isAdmin = false;
        localStorage.removeItem('snake-current-user');
        localStorage.removeItem('snake-admin');
    }

    isLoggedIn() {
        const username = localStorage.getItem('snake-current-user');
        const isAdmin = localStorage.getItem('snake-admin') === 'true';
        if (username && (this.users[username] || isAdmin)) {
            this.currentUser = username;
            this.isAdmin = isAdmin;
            return true;
        }
        return false;
    }

    saveUserData(key, value) {
        if (!this.currentUser) return;
        this.users[this.currentUser].data[key] = value;
        this.saveUsers();
    }

    getUserData(key) {
        if (!this.currentUser) return null;
        return this.users[this.currentUser].data[key];
    }

    init() {
        // 切换登录/注册表单
        document.getElementById('show-register').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
            document.getElementById('github-sync').style.display = 'block';
            document.getElementById('email-config').style.display = 'block';
        });

        document.getElementById('show-login').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('github-sync').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        });

        // 开发者入口切换
        document.getElementById('show-admin').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('admin-form').style.display = 'block';
        });

        document.getElementById('show-user-login').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('admin-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        });

        // 忘记密码
        document.getElementById('show-forgot').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('forgot-form').style.display = 'block';
        });

        document.getElementById('show-user-login2').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('forgot-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        });

        // 设置共享 GitHub Token（供所有玩家使用）
        const setSharedTokenBtn = document.getElementById('set-shared-token-btn');
        if (setSharedTokenBtn) {
            setSharedTokenBtn.addEventListener('click', async () => {
                const token = document.getElementById('shared-github-token').value.trim();
                const statusEl = document.getElementById('shared-token-status');

                if (!token) {
                    statusEl.textContent = '请输入 Token';
                    statusEl.style.color = 'red';
                    return;
                }

                statusEl.textContent = '正在验证并保存 Token...';

                try {
                    // 验证 Token
                    const response = await fetch('https://api.github.com/user', {
                        method: 'GET',
                        headers: {
                            'Authorization': `token ${token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (response.ok) {
                        const userData = await response.json();
                        // 保存为共享 Token
                        localStorage.setItem('snake-shared-github-token', token);
                        localStorage.setItem('snake-shared-github-user', userData.login);

                        // 同时保存到GitHub Gist，让其他用户也能获取
                        try {
                            // 查找现有Gist
                            const listResponse = await fetch('https://api.github.com/gists', {
                                headers: {
                                    'Authorization': `token ${token}`,
                                    'Accept': 'application/vnd.github.v3+json'
                                }
                            });

                            let existingGistId = localStorage.getItem('snake-users-gist-id');
                            if (listResponse.ok) {
                                const gists = await listResponse.json();
                                const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                                if (existingGist) {
                                    existingGistId = existingGist.id;
                                }
                            }

                            const gistData = {
                                description: 'Snake Game Users Data',
                                public: false,
                                files: {
                                    'snake-users.json': {
                                        content: JSON.stringify(this.users || {}, null, 2)
                                    },
                                    'snake-config.json': {
                                        content: JSON.stringify({
                                            sharedToken: token,
                                            sharedUser: userData.login
                                        }, null, 2)
                                    }
                                }
                            };

                            let url = 'https://api.github.com/gists';
                            let method = 'POST';
                            if (existingGistId) {
                                // 更新现有Gist
                                const getGist = await fetch(`https://api.github.com/gists/${existingGistId}`, {
                                    headers: {
                                        'Authorization': `token ${token}`,
                                        'Accept': 'application/vnd.github.v3+json'
                                    }
                                });
                                if (getGist.ok) {
                                    const gist = getGist.json();
                                    gistData.files['snake-records.json'] = { content: gist.files['snake-records.json']?.content || '[]' };
                                    gistData.files['snake-top-records.json'] = { content: gist.files['snake-top-records.json']?.content || '[]' };
                                }
                                url += `/${existingGistId}`;
                                method = 'PATCH';
                            }

                            await fetch(url, {
                                method: method,
                                headers: {
                                    'Authorization': `token ${token}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(gistData)
                            });
                        } catch (e) {
                            console.log('保存共享Token到Gist失败', e);
                        }

                        statusEl.textContent = '✓ 共享 Token 已保存到云端！其他用户登录时将自动获取。';
                        statusEl.style.color = 'green';
                        console.log('共享 Token 已设置，用户:', userData.login);
                    } else {
                        statusEl.textContent = '✗ Token 无效或已过期';
                        statusEl.style.color = 'red';
                    }
                } catch (error) {
                    statusEl.textContent = '✗ 验证失败: ' + error.message;
                    statusEl.style.color = 'red';
                }
            });
        }

        // 忘记密码 - 第一步：发送重置链接
        document.getElementById('forgot-btn').addEventListener('click', () => {
            const username = document.getElementById('forgot-username').value.trim();
            const email = document.getElementById('forgot-email').value.trim();

            const user = this.users[username];
            if (!user) {
                document.getElementById('auth-error').textContent = '用户不存在';
                return;
            }
            if (user.email !== email) {
                document.getElementById('auth-error').textContent = '用户名与邮箱不匹配';
                return;
            }

            // 生成重置码
            const resetCode = Math.random().toString(36).substring(2, 10);
            localStorage.setItem('snake-reset-code', resetCode);
            localStorage.setItem('snake-reset-user', username);

            // 生成重置链接
            const resetLink = `${window.location.origin}${window.location.pathname}?reset=${resetCode}`;

            // 发送邮件
            document.getElementById('auth-error').textContent = '正在发送邮件...';

            this.sendPasswordResetEmail(email, username, resetLink).then(() => {
                document.getElementById('forgot-step1').style.display = 'none';
                document.getElementById('forgot-step2').style.display = 'block';
                document.getElementById('auth-error').textContent = '';
            }).catch(() => {
                document.getElementById('forgot-step1').style.display = 'none';
                document.getElementById('forgot-step2').style.display = 'block';
                document.getElementById('auth-error').textContent = '';
            });
        });

        // 忘记密码 - 第二步：使用链接
        document.getElementById('use-link-btn').addEventListener('click', () => {
            document.getElementById('forgot-step2').style.display = 'none';
            document.getElementById('forgot-step3').style.display = 'block';
        });

        // 忘记密码 - 第三步：确认重置
        document.getElementById('confirm-reset-btn').addEventListener('click', () => {
            const newPassword = document.getElementById('new-password-input').value;
            const confirmPassword = document.getElementById('new-password-confirm').value;
            const resetCode = localStorage.getItem('snake-reset-code');
            const resetUser = localStorage.getItem('snake-reset-user');

            if (!resetCode || !resetUser) {
                alert('重置链接已失效，请重新获取');
                window.location.href = window.location.pathname;
                return;
            }

            if (newPassword !== confirmPassword) {
                alert('两次输入的密码不一致');
                return;
            }

            if (newPassword.length < 3) {
                alert('密码至少3位');
                return;
            }

            // 重置密码
            this.users[resetUser].password = simpleHash(newPassword);
            this.saveUsers();

            // 清理
            localStorage.removeItem('snake-reset-code');
            localStorage.removeItem('snake-reset-user');

            alert('密码重置成功！请使用新密码登录');
            // 清理URL参数
            window.history.pushState({}, '', window.location.pathname);
            // 重置表单
            document.getElementById('forgot-username').value = '';
            document.getElementById('forgot-email').value = '';
            document.getElementById('new-password-input').value = '';
            document.getElementById('new-password-confirm').value = '';
            document.getElementById('forgot-step1').style.display = 'block';
            document.getElementById('forgot-step2').style.display = 'none';
            document.getElementById('forgot-step3').style.display = 'none';
            document.getElementById('forgot-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        });

        // 检查URL是否有重置参数
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('reset')) {
            const code = urlParams.get('reset');
            const storedCode = localStorage.getItem('snake-reset-code');
            if (code === storedCode) {
                document.getElementById('auth-panel').classList.remove('show');
                document.getElementById('forgot-form').style.display = 'block';
                document.getElementById('forgot-step1').style.display = 'none';
                document.getElementById('forgot-step2').style.display = 'none';
                document.getElementById('forgot-step3').style.display = 'block';
            } else {
                alert('无效的重置链接');
                window.history.pushState({}, '', window.location.pathname);
            }
        }

        // 开发者登录 - 使用 GitHub API 验证
        document.getElementById('admin-login-btn').addEventListener('click', async () => {
            const username = document.getElementById('admin-username').value.trim();
            const password = document.getElementById('admin-password').value;

            if (!username || !password) {
                document.getElementById('auth-error').textContent = '请输入 GitHub 用户名和密码';
                return;
            }

            document.getElementById('auth-error').textContent = '正在验证...';

            try {
                // 使用 GitHub API 验证用户
                const response = await fetch(`https://api.github.com/users/${username}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${password}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (response.ok) {
                    const userData = await response.json();
                    // 开发者登录成功，标记为 admin
                    this.currentUser = username;
                    this.isAdmin = true;
                    localStorage.setItem('snake-current-user', username);
                    localStorage.setItem('snake-admin', 'true');
                    document.getElementById('auth-error').textContent = '';
                    this.showGame();
                } else if (response.status === 401) {
                    document.getElementById('auth-error').innerHTML = 'GitHub 已停止密码认证，请使用 <a href="#" onclick="document.getElementById(\'admin-form\').style.display=\'none\';document.getElementById(\'login-form\').style.display=\'block\';">普通用户登录</a> 或使用 Token 登录';
                } else if (response.status === 404) {
                    document.getElementById('auth-error').textContent = 'GitHub 用户不存在';
                } else {
                    document.getElementById('auth-error').textContent = '验证失败: ' + response.statusText;
                }
            } catch (error) {
                document.getElementById('auth-error').textContent = '验证失败: ' + error.message;
            }
        });

        // 管理员 Token 登录
        document.getElementById('admin-token-login-btn').addEventListener('click', async () => {
            const token = document.getElementById('admin-github-token').value.trim();

            if (!token) {
                document.getElementById('auth-error').textContent = '请输入 GitHub Token';
                return;
            }

            document.getElementById('auth-error').textContent = '正在验证...';

            try {
                // 使用 GitHub API 验证 Token
                const response = await fetch('https://api.github.com/user', {
                    method: 'GET',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (response.ok) {
                    const userData = await response.json();
                    // 管理员登录成功
                    this.currentUser = userData.login;
                    this.isAdmin = true;
                    localStorage.setItem('snake-current-user', userData.login);
                    localStorage.setItem('snake-admin', 'true');
                    localStorage.setItem('snake-github-token', token);

                    // 同时设置为共享 Token
                    localStorage.setItem('snake-shared-github-token', token);
                    localStorage.setItem('snake-shared-github-user', userData.login);

                    // 异步从 GitHub 加载最新用户数据
                    await this.refreshUsers();
                    console.log('用户数据已刷新');

                    document.getElementById('auth-error').textContent = '';
                    this.showGame();
                } else if (response.status === 401) {
                    document.getElementById('auth-error').textContent = 'Token 无效或已过期';
                } else {
                    document.getElementById('auth-error').textContent = '验证失败: ' + response.statusText;
                }
            } catch (error) {
                document.getElementById('auth-error').textContent = '验证失败: ' + error.message;
            }
        });

        // GitHub OAuth 登录（已移除，此功能整合到管理员登录中）

        // 登录
        document.getElementById('login-btn').addEventListener('click', async () => {
            // 先从GitHub加载数据（如果有Token）
            const githubToken = this.getGitHubToken();
            if (githubToken) {
                console.log('登录时从GitHub加载数据...');
                await this.refreshUsers();
            }

            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;

            const result = this.login(username, password);
            if (result.success) {
                document.getElementById('auth-error').textContent = '';
                this.showGame();
            } else {
                document.getElementById('auth-error').textContent = result.message;
            }
        });

        // 注册
        document.getElementById('register-btn').addEventListener('click', () => {
            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const password2 = document.getElementById('reg-password2').value;

            if (password !== password2) {
                document.getElementById('auth-error').textContent = '两次密码不一致';
                return;
            }

            const result = this.register(username, password, email);
            if (result.success) {
                // 检查是否有 GitHub Token，如果有则自动同步
                const githubToken = document.getElementById('github-token').value.trim();
                if (githubToken) {
                    localStorage.setItem('snake-github-token', githubToken);
                    document.getElementById('auth-error').style.color = 'green';
                    document.getElementById('auth-error').textContent = '注册成功！正在同步到GitHub...';
                    // 自动同步
                    this.syncToGitHub(githubToken).then(() => {
                        document.getElementById('auth-error').textContent = '注册成功！已同步到GitHub，请登录';
                    }).catch(() => {
                        document.getElementById('auth-error').textContent = '注册成功！同步失败，请登录后手动同步';
                    });
                } else {
                    document.getElementById('auth-error').style.color = 'green';
                    document.getElementById('auth-error').textContent = '注册成功！请登录';
                }
                setTimeout(() => {
                    document.getElementById('reg-username').value = '';
                    document.getElementById('reg-email').value = '';
                    document.getElementById('reg-password').value = '';
                    document.getElementById('reg-password2').value = '';
                    document.getElementById('register-form').style.display = 'none';
                    document.getElementById('github-sync').style.display = 'none';
                    document.getElementById('login-form').style.display = 'block';
                    document.getElementById('auth-error').textContent = '';
                }, 1500);
            } else {
                document.getElementById('auth-error').style.color = 'red';
                document.getElementById('auth-error').textContent = result.message;
            }
        });

        // GitHub 同步
        document.getElementById('sync-btn').addEventListener('click', () => {
            this.syncToGitHub();
        });

        // GitHub 下载
        document.getElementById('download-btn').addEventListener('click', () => {
            this.downloadFromGitHub();
        });

        // 检查是否已登录
        if (this.isLoggedIn()) {
            this.showGame();
        }
    }

    showGame() {
        document.getElementById('auth-panel').classList.remove('show');
        document.getElementById('game-container').style.display = 'block';
        document.getElementById('game-container').classList.add('show');

        // 自动设置玩家姓名为用户名
        const playerNameInput = document.getElementById('player-name');
        if (playerNameInput) {
            playerNameInput.value = this.currentUser;
        }

        // 显示用户信息
        const header = document.querySelector('.game-header');
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        const adminBadge = this.isAdmin ? ' <span style="color:#e74c3c;">[管理员]</span>' : '';
        userInfo.innerHTML = `
            <span>欢迎, ${this.currentUser}${adminBadge}</span>
            <button class="change-pass-btn" id="change-pass-btn">修改密码</button>
            <button class="logout-btn" id="logout-btn">退出</button>
        `;
        header.insertBefore(userInfo, header.firstChild);

        // 修改密码按钮
        document.getElementById('change-pass-btn').addEventListener('click', () => {
            this.showChangePasswordDialog();
        });

        // 开发者模式下显示管理面板按钮
        if (this.isAdmin) {
            this.showAdminPanel();
        }

        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
            location.reload();
        });

        // 初始化游戏
        initGame();

        // 立即刷新记录显示（确保显示从GitHub加载的数据）
        if (game) {
            game.displayRecords();
        }
    }

    showAdminPanel() {
        // 添加管理员按钮到控制栏
        const controls = document.querySelector('.game-controls');
        const adminBtn = document.createElement('button');
        adminBtn.id = 'admin-panel-btn';
        adminBtn.textContent = '👑 管理';
        adminBtn.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
        controls.appendChild(adminBtn);

        // 点击显示管理面板
        adminBtn.addEventListener('click', () => {
            this.toggleAdminPanel();
        });
    }

    toggleAdminPanel() {
        let panel = document.getElementById('admin-panel');
        if (panel) {
            panel.remove();
            return;
        }

        const self = this;

        // 创建管理面板
        panel = document.createElement('div');
        panel.id = 'admin-panel';
        panel.className = 'modal show';
        panel.innerHTML = `
            <div class="modal-content" style="max-width:600px;">
                <span class="close" onclick="this.parentElement.parentElement.remove()">&times;</span>
                <h2>👑 管理员面板</h2>
                <div class="admin-section">
                    <h3>用户管理</h3>
                    <div style="margin-bottom:10px;">
                        <input type="text" id="target-username" placeholder="用户名" style="padding:8px;width:150px;">
                        <input type="text" id="new-password" placeholder="新密码" style="padding:8px;width:120px;">
                        <button id="reset-user-pass" class="auth-btn" style="padding:8px 15px;width:auto;margin:0;">重置密码</button>
                    </div>
                    <div style="margin-bottom:10px;">
                        <input type="text" id="view-username" placeholder="查看用户名" style="padding:8px;width:150px;">
                        <button id="view-user-data" class="auth-btn" style="padding:8px 15px;width:auto;margin:0;">查看数据</button>
                    </div>
                    <div id="user-data-view" style="display:none;background:#fff;padding:10px;border-radius:5px;max-height:200px;overflow-y:auto;"></div>
                    <div id="user-list"></div>
                </div>
                <div class="admin-section">
                    <h3>全局统计</h3>
                    <div id="global-stats"></div>
                </div>
                <div class="admin-section">
                    <h3>游戏记录管理</h3>
                    <button id="view-all-records" class="auth-btn" style="padding:8px 15px;margin:5px 0;">查看所有记录</button>
                    <button id="clear-all-records-btn" class="auth-btn" style="padding:8px 15px;margin:5px 0;background:#e74c3c;">清空所有记录</button>
                    <div id="all-records-view" style="display:none;background:#fff;padding:10px;border-radius:5px;max-height:300px;overflow-y:auto;margin-top:10px;"></div>
                </div>
                <div class="admin-section">
                    <h3>数据管理</h3>
                    <button id="export-all-data" class="auth-btn" style="padding:8px 15px;margin:5px 0;background:#2ecc71;">导出全部数据</button>
                    <button id="clear-all-btn" class="auth-btn" style="background:#e74c3c;">清空所有数据</button>
                </div>
                <div class="admin-section">
                    <h3>EmailJS 邮件配置</h3>
                    <div style="margin-bottom:10px;">
                        <input type="text" id="emailjs-public-key" placeholder="Public Key" style="padding:8px;width:200px;margin:5px 0;">
                        <input type="text" id="emailjs-service-id" placeholder="Service ID" style="padding:8px;width:200px;margin:5px 0;">
                        <input type="text" id="emailjs-template-id" placeholder="Template ID" style="padding:8px;width:200px;margin:5px 0;">
                        <button id="save-email-config" class="auth-btn" style="padding:8px 15px;width:auto;margin:0;">保存配置</button>
                    </div>
                    <p style="font-size:12px;color:#666;"><strong>配置说明（重要！）：</strong></p>
                    <ol style="font-size:12px;color:#666;margin-left:20px;">
                        <li>注册 <a href="https://www.emailjs.com/" target="_blank">EmailJS</a> 账号</li>
                        <li><strong>删除旧服务重建：</strong>如果之前Gmail服务权限不足，先在EmailJS后台删除 Gmail 服务，重新添加</li>
                        <li>添加 Gmail 服务时，必须勾选 <strong>"Send email on your behalf"</strong> 权限</li>
                        <li>创建 Email Template，变量用: <code>{{to_name}}</code>, <code>{{reset_link}}</code></li>
                        <li>获取 Public Key（在 Account → API Keys）</li>
                        <li>获取 Service ID（Email Services 中）</li>
                        <li>获取 Template ID（Email Templates 中）</li>
                    </ol>
                    <p style="font-size:12px;color:#e74c3c;background:#fdf0ef;padding:10px;border-radius:5px;">
                        <strong>如果遇到 "insufficient authentication biases" 错误：</strong><br>
                        必须删除旧的 Gmail 服务，重新连接并授予 <strong>"Send email on your behalf"</strong> 权限
                    </p>
                    <div id="email-config-status" style="margin-top:10px;font-size:12px;"></div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        this.loadAdminData();
        this.loadEmailConfig();

        // 保存邮件配置
        document.getElementById('save-email-config').addEventListener('click', () => {
            const publicKey = document.getElementById('emailjs-public-key').value.trim();
            const serviceId = document.getElementById('emailjs-service-id').value.trim();
            const templateId = document.getElementById('emailjs-template-id').value.trim();

            if (!publicKey || !serviceId || !templateId) {
                alert('请填写完整的 EmailJS 配置');
                return;
            }

            const config = { publicKey, serviceId, templateId };
            localStorage.setItem('snake-emailjs-config', JSON.stringify(config));

            // 更新内存中的配置
            EMAILJS_CONFIG.publicKey = publicKey;
            EMAILJS_CONFIG.serviceId = serviceId;
            EMAILJS_CONFIG.templateId = templateId;

            // 初始化 EmailJS
            if (typeof emailjs !== 'undefined') {
                emailjs.init(publicKey);
            }

            document.getElementById('email-config-status').innerHTML = '<span style="color:green;">✓ 配置已保存，邮件功能已启用</span>';
        });

        // 重置用户密码
        document.getElementById('reset-user-pass').addEventListener('click', () => {
            const username = document.getElementById('target-username').value.trim();
            const newPassword = document.getElementById('new-password').value;
            if (!username || !newPassword) {
                alert('请输入用户名和新密码');
                return;
            }
            const result = this.adminResetPassword(username, newPassword);
            alert(result.message);
            if (result.success) {
                document.getElementById('target-username').value = '';
                document.getElementById('new-password').value = '';
                self.loadAdminData();
            }
        });

        // 查看用户数据
        document.getElementById('view-user-data').addEventListener('click', () => {
            const username = document.getElementById('view-username').value.trim();
            if (!username) {
                alert('请输入用户名');
                return;
            }
            const userData = this.adminGetUserData(username);
            const dataView = document.getElementById('user-data-view');
            if (userData) {
                dataView.style.display = 'block';
                dataView.innerHTML = `
                    <p><strong>用户名:</strong> ${username}</p>
                    <p><strong>邮箱:</strong> ${userData.email || '未设置'}</p>
                    <p><strong>注册时间:</strong> ${userData.created || '未知'}</p>
                    <p><strong>游戏数据:</strong></p>
                    <pre style="background:#f5f5f5;padding:10px;overflow-x:auto;font-size:12px;">${JSON.stringify(userData.data, null, 2)}</pre>
                `;
            } else {
                dataView.style.display = 'block';
                dataView.innerHTML = '<p style="color:red;">用户不存在</p>';
            }
        });

        // 导出全部数据
        document.getElementById('export-all-data').addEventListener('click', () => {
            const allData = {
                exportTime: new Date().toISOString(),
                users: this.users,
                records: JSON.parse(localStorage.getItem('snake-records') || '[]'),
                topRecords: JSON.parse(localStorage.getItem('snake-top-records') || '[]'),
                playerNames: JSON.parse(localStorage.getItem('snake-player-names') || '[]'),
                emailjsConfig: localStorage.getItem('snake-emailjs-config')
            };
            const blob = new Blob([JSON.stringify(allData, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'snake-game-backup-' + new Date().toISOString().substring(0,10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            alert('数据已导出为 JSON 文件');
        });

        // 查看所有游戏记录
        document.getElementById('view-all-records').addEventListener('click', () => {
            const records = JSON.parse(localStorage.getItem('snake-records') || '[]');
            const topRecords = JSON.parse(localStorage.getItem('snake-top-records') || '[]');
            const view = document.getElementById('all-records-view');

            let html = '<h4>最近游戏记录（按时间排序，最新在前）</h4>';
            if (records.length === 0) {
                html += '<p>暂无记录</p>';
            } else {
                const sortedRecords = [...records].sort((a, b) => new Date(b.date) - new Date(a.date));
                html += '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f5f5f5;"><th style="text-align:left;padding:6px;">玩家</th><th style="text-align:right;padding:6px;">分数</th><th style="text-align:left;padding:6px;">模式</th><th style="text-align:left;padding:6px;">日期</th></tr>';
                sortedRecords.slice(0, 50).forEach(r => {
                    const modeName = {'classic': '经典', 'timed': '限时', 'endless': '无尽', 'battle': '对战'}[r.mode] || r.mode;
                    html += `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${r.playerName || r.username || '-'}</td><td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${r.score}</td><td style="padding:6px;border-bottom:1px solid #eee;">${modeName}</td><td style="padding:6px;border-bottom:1px solid #eee;">${r.date ? r.date.substring(0,16) : '-'}</td></tr>`;
                });
                html += '</table>';
                if (records.length > 50) {
                    html += `<p style="color:#666;font-size:12px;">...还有 ${records.length - 50} 条记录未显示</p>`;
                }
            }
            view.innerHTML = html;
            view.style.display = 'block';
        });

        // 清空所有游戏记录
        document.getElementById('clear-all-records-btn').addEventListener('click', () => {
            if (confirm('确定要清空所有游戏记录吗？此操作不可恢复！')) {
                localStorage.removeItem('snake-records');
                localStorage.removeItem('snake-top-records');
                alert('游戏记录已清空');
                self.loadAdminData();
            }
        });

        // 清空所有数据
        document.getElementById('clear-all-btn').addEventListener('click', () => {
            if (confirm('确定要清空所有数据吗？此操作不可恢复！')) {
                localStorage.clear();
                alert('数据已清空');
                location.reload();
            }
        });
    }

    loadAdminData() {
        const users = Object.keys(this.users);

        // 显示用户列表（带删除功能）
        const userList = document.getElementById('user-list');
        if (users.length === 0) {
            userList.innerHTML = '<p>暂无注册用户</p>';
        } else {
            let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#f5f5f5;"><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">用户名</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">邮箱</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">注册时间</th><th style="text-align:center;padding:8px;border-bottom:1px solid #ddd;">操作</th></tr>';
            users.forEach(u => {
                const user = this.users[u];
                html += `<tr>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${u}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${user.email || '-'}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${user.created ? user.created.substring(0,10) : '-'}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">
                        <button onclick="window.auth.adminDeleteUser('${u}'); game.loadAdminData();" style="background:#e74c3c;color:white;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;">删除</button>
                    </td>
                </tr>`;
            });
            html += '</table>';
            userList.innerHTML = html;
        }

        // 计算全局统计数据
        let totalGames = 0;
        let totalScore = 0;
        let topScore = 0;
        const records = JSON.parse(localStorage.getItem('snake-records') || '[]');
        records.forEach(r => {
            totalGames++;
            totalScore += r.score || 0;
            if (r.score > topScore) topScore = r.score;
        });

        // 显示全局统计
        const stats = document.getElementById('global-stats');
        stats.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                <div style="background:#f5f5f5;padding:10px;border-radius:5px;text-align:center;">
                    <div style="font-size:24px;font-weight:bold;color:#667eea;">${users.length}</div>
                    <div style="font-size:12px;color:#666;">总用户数</div>
                </div>
                <div style="background:#f5f5f5;padding:10px;border-radius:5px;text-align:center;">
                    <div style="font-size:24px;font-weight:bold;color:#667eea;">${totalGames}</div>
                    <div style="font-size:12px;color:#666;">总游戏次数</div>
                </div>
                <div style="background:#f5f5f5;padding:10px;border-radius:5px;text-align:center;">
                    <div style="font-size:24px;font-weight:bold;color:#667eea;">${topScore}</div>
                    <div style="font-size:12px;color:#666;">最高分</div>
                </div>
                <div style="background:#f5f5f5;padding:10px;border-radius:5px;text-align:center;">
                    <div style="font-size:24px;font-weight:bold;color:#667eea;">${records.length}</div>
                    <div style="font-size:12px;color:#666;">游戏记录数</div>
                </div>
            </div>
        `;
    }

    // 管理员删除用户
    adminDeleteUserConfirm(username) {
        if (confirm(`确定要删除用户 "${username}" 吗？此操作不可恢复！`)) {
            const result = window.auth.adminDeleteUser(username);
            if (result.success) {
                // 同时删除该用户的成就、记录等数据
                localStorage.removeItem(`snake-achievements-${username}`);
                localStorage.removeItem(`snake-records-${username}`);
                localStorage.removeItem(`snake-stats-${username}`);
                localStorage.removeItem(`snake-skins-${username}`);
                localStorage.removeItem(`snake-sounds-${username}`);
                alert('用户已删除');
                this.loadAdminData();
            } else {
                alert(result.message);
            }
        }
    }

    async syncToGitHub(externalToken = null) {
        let token = externalToken;
        if (!token) {
            token = document.getElementById('github-token')?.value.trim();
        }
        if (!token) {
            token = localStorage.getItem('snake-github-token');
        }
        if (!token) {
            alert('请输入 GitHub Token');
            return Promise.reject();
        }

        const username = this.currentUser;
        const userData = this.users[username];

        try {
            // 创建或更新 Gist
            const gistData = {
                description: 'Snake Game User Data',
                public: false,
                files: {
                    'snake-game-data.json': {
                        content: JSON.stringify({
                            username: username,
                            data: userData.data,
                            achievements: localStorage.getItem('snake-achievements'),
                            records: localStorage.getItem('snake-records'),
                            stats: localStorage.getItem('snake-stats'),
                            skins: localStorage.getItem('snake-skins'),
                            sounds: localStorage.getItem('snake-sounds')
                        }, null, 2)
                    }
                }
            };

            const response = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });

            if (response.ok) {
                const gist = await response.json();
                localStorage.setItem('snake-gist-id', gist.id);
                localStorage.setItem('snake-github-token', token);
                alert('同步成功！Gist ID: ' + gist.id);
            } else {
                alert('同步失败: ' + response.statusText);
            }
        } catch (error) {
            alert('同步失败: ' + error.message);
        }
    }

    // 从 GitHub Gist 下载数据
    async downloadFromGitHub() {
        const gistId = localStorage.getItem('snake-gist-id');
        const token = localStorage.getItem('snake-github-token');

        if (!gistId) {
            alert('没有找到 GitHub 同步记录，请先进行云同步');
            return;
        }

        if (!token) {
            alert('请先在登录界面输入 GitHub Token');
            return;
        }

        try {
            const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.ok) {
                const gist = await response.json();
                const content = gist.files['snake-game-data.json'].content;
                const data = JSON.parse(content);

                // 恢复数据
                if (data.achievements) {
                    localStorage.setItem('snake-achievements', data.achievements);
                }
                if (data.records) {
                    localStorage.setItem('snake-records', data.records);
                }
                if (data.stats) {
                    localStorage.setItem('snake-stats', data.stats);
                }
                if (data.skins) {
                    localStorage.setItem('snake-skins', data.skins);
                }
                if (data.sounds) {
                    localStorage.setItem('snake-sounds', data.sounds);
                }

                alert('数据下载成功！请刷新页面查看');
            } else if (response.status === 404) {
                alert('Gist 不存在或已被删除');
            } else {
                alert('下载失败: ' + response.statusText);
            }
        } catch (error) {
            alert('下载失败: ' + error.message);
        }
    }
}

// 游戏初始化
let game;

function initGame() {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    game = new SnakeGame(canvas, ctx);

    game.displayRecords('mine');
    game.updatePlayerNamesDropdown();
    game.handleModeChange(document.getElementById('game-mode').value);
    game.updateModeUI(document.getElementById('game-mode').value);
    game.initRecordTabs();
    game.draw();
}

// 页面加载完成后初始化认证
document.addEventListener('DOMContentLoaded', () => {
    window.auth = new AuthSystem();
    window.auth.initAuth();
});

class SnakeGame {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.gridSize = 20;
        this.snake = [{x: 10, y: 10}];
        this.direction = {x: 1, y: 0};
        this.food = this.generateFood();
        this.score = 0;
        this.gameTime = 0;
        this.speed = 5;
        this.baseSpeed = 5;
        this.isRunning = false;
        this.isPaused = false;
        this.timeRemaining = this.gameTime;
        this.playerName = '';
        this.gameTimer = null;
        this.speedTimer = null;

        // 双人模式
        this.isTwoPlayerMode = false;
        this.snake2 = null;
        this.direction2 = {x: -1, y: 0};
        this.p2Name = 'P2';
        this.p2Score = 0;

        // 道具系统
        this.powerups = [];
        this.activeEffects = {
            speedUp: false,
            speedDown: false,
            invincible: false
        };
        this.invincibleUses = 0;
        this.ghostUses = 0;

        // 连击系统
        this.combo = 0;
        this.lastFoodTime = 0;

        // 无尽模式
        this.foodsEaten = 0;
        this.isEndlessMode = false;

        // 成就系统
        this.achievements = this.loadAchievements();
        this.stats = this.loadStats();

        // 皮肤设置
        this.skinSettings = this.loadSkinSettings();

        // 音效设置
        this.soundSettings = this.loadSoundSettings();

        // 音频上下文
        this.audioContext = null;

        // 绑定事件监听器
        this.bindEvents();
    }

    bindEvents() {
        // 键盘控制
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ') {
                e.preventDefault();
                if (!this.isRunning) {
                    this.start();
                } else {
                    this.togglePause();
                }
                return;
            }

            if (!this.isRunning || this.isPaused) return;

            if (this.isTwoPlayerMode) {
                // P1 控制 (WASD)
                switch(e.key.toLowerCase()) {
                    case 'w':
                        if (this.direction.y === 0) this.direction = {x: 0, y: -1};
                        break;
                    case 's':
                        if (this.direction.y === 0) this.direction = {x: 0, y: 1};
                        break;
                    case 'a':
                        if (this.direction.x === 0) this.direction = {x: -1, y: 0};
                        break;
                    case 'd':
                        if (this.direction.x === 0) this.direction = {x: 1, y: 0};
                        break;
                }

                // P2 控制 (方向键)
                switch(e.key) {
                    case 'ArrowUp':
                        e.preventDefault();
                        if (this.direction2.y === 0) this.direction2 = {x: 0, y: -1};
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        if (this.direction2.y === 0) this.direction2 = {x: 0, y: 1};
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        if (this.direction2.x === 0) this.direction2 = {x: -1, y: 0};
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        if (this.direction2.x === 0) this.direction2 = {x: 1, y: 0};
                        break;
                }
            } else {
                // 单人模式
                switch(e.key) {
                    case 'ArrowUp':
                    case 'w':
                    case 'W':
                        e.preventDefault();
                        if (this.direction.y === 0) this.direction = {x: 0, y: -1};
                        break;
                    case 'ArrowDown':
                    case 's':
                    case 'S':
                        e.preventDefault();
                        if (this.direction.y === 0) this.direction = {x: 0, y: 1};
                        break;
                    case 'ArrowLeft':
                    case 'a':
                    case 'A':
                        e.preventDefault();
                        if (this.direction.x === 0) this.direction = {x: -1, y: 0};
                        break;
                    case 'ArrowRight':
                    case 'd':
                    case 'D':
                        e.preventDefault();
                        if (this.direction.x === 0) this.direction = {x: 1, y: 0};
                        break;
                }
            }

            // 通用快捷键
            switch(e.key.toLowerCase()) {
                case 'f':
                    this.toggleFullscreen();
                    break;
            }
        });

        // 按钮控制
        document.getElementById('start-btn').addEventListener('click', () => this.start());
        document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('clear-records-btn').addEventListener('click', () => this.clearRecords());
        document.getElementById('achievements-btn').addEventListener('click', () => this.showAchievements());
        document.getElementById('skins-btn').addEventListener('click', () => this.showSkins());
        document.getElementById('sound-btn').addEventListener('click', () => this.showSoundSettings());

        // 速度控制
        document.getElementById('game-speed').addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            this.baseSpeed = this.speed;
            document.getElementById('speed-value').textContent = this.speed;
            document.getElementById('current-speed').textContent = this.getCurrentSpeed();
        });

        // 游戏模式控制
        document.getElementById('game-mode').addEventListener('change', (e) => {
            this.handleModeChange(e.target.value);
        });

        // 皮肤保存
        document.getElementById('save-skins-btn').addEventListener('click', () => this.saveSkins());
        document.getElementById('save-sound-btn').addEventListener('click', () => this.saveSoundSettings());

        // 全屏变化事件
        document.addEventListener('fullscreenchange', () => {
            const container = document.querySelector('.game-container');
            if (!document.fullscreenElement) {
                container.classList.remove('fullscreen-mode');
            }
        });

        // 模态框关闭
        document.querySelectorAll('.modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('show'));
            });
        });

        // 点击模态框外部关闭
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });
        });
    }

    handleModeChange(mode) {
        const timeLimitContainer = document.getElementById('time-limit-container');
        const classicTimeContainer = document.getElementById('classic-time-container');
        const powerupsContainer = document.getElementById('powerups-container');

        switch(mode) {
            case 'timed':
                timeLimitContainer.style.display = 'flex';
                classicTimeContainer.style.display = 'none';
                powerupsContainer.style.display = 'flex';
                break;
            case 'endless':
                timeLimitContainer.style.display = 'none';
                classicTimeContainer.style.display = 'none';
                powerupsContainer.style.display = 'none';
                break;
            case 'battle':
                timeLimitContainer.style.display = 'none';
                classicTimeContainer.style.display = 'none';
                powerupsContainer.style.display = 'none';
                break;
            default: // classic
                timeLimitContainer.style.display = 'none';
                classicTimeContainer.style.display = 'flex';
                powerupsContainer.style.display = 'flex';
        }

        // 更新 UI
        this.updateModeUI(mode);
    }

    updateModeUI(mode) {
        const timeStat = document.getElementById('time-stat');
        const comboStat = document.getElementById('combo-stat');
        const p2ScoreStat = document.getElementById('p2-score-stat');

        switch(mode) {
            case 'timed':
                timeStat.style.display = 'block';
                comboStat.style.display = 'block';
                p2ScoreStat.style.display = 'none';
                break;
            case 'endless':
                timeStat.style.display = 'none';
                comboStat.style.display = 'block';
                p2ScoreStat.style.display = 'none';
                break;
            case 'battle':
                timeStat.style.display = 'none';
                comboStat.style.display = 'none';
                p2ScoreStat.style.display = 'block';
                break;
            default:
                timeStat.style.display = 'block';
                comboStat.style.display = 'block';
                p2ScoreStat.style.display = 'none';
        }
    }

    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playSound(type) {
        if (!this.soundSettings.enabled) return;

        this.initAudio();

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        switch(type) {
            case 'eat':
                oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(1200, this.audioContext.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
                oscillator.start(this.audioContext.currentTime);
                oscillator.stop(this.audioContext.currentTime + 0.1);
                break;
            case 'powerup':
                oscillator.frequency.setValueAtTime(400, this.audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(600, this.audioContext.currentTime + 0.15);
                oscillator.frequency.exponentialRampToValueAtTime(800, this.audioContext.currentTime + 0.3);
                gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
                oscillator.start(this.audioContext.currentTime);
                oscillator.stop(this.audioContext.currentTime + 0.3);
                break;
            case 'gameover':
                oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);
                oscillator.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.5);
                gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
                oscillator.start(this.audioContext.currentTime);
                oscillator.stop(this.audioContext.currentTime + 0.5);
                break;
            case 'achievement':
                oscillator.frequency.setValueAtTime(523, this.audioContext.currentTime);
                oscillator.frequency.setValueAtTime(659, this.audioContext.currentTime + 0.1);
                oscillator.frequency.setValueAtTime(784, this.audioContext.currentTime + 0.2);
                gainNode.gain.setValueAtTime(0.15, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
                oscillator.start(this.audioContext.currentTime);
                oscillator.stop(this.audioContext.currentTime + 0.3);
                break;
        }
    }

    generateFood() {
        const x = Math.floor(Math.random() * (this.canvas.width / this.gridSize));
        const y = Math.floor(Math.random() * (this.canvas.height / this.gridSize));
        return {x, y, type: 'normal'};
    }

    generatePowerup() {
        // 道具类型：金色食物、炸弹、各种速度道具、无敌、穿身
        const types = ['gold', 'bomb', 'car', 'train', 'plane', 'snail', 'koala', 'turtle', 'invincible', 'ghost'];
        const weights = [20, 12, 6, 6, 6, 6, 6, 6, 6, 6]; // 权重

        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;

        let type = types[0];
        for (let i = 0; i < types.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                type = types[i];
                break;
            }
        }

        const x = Math.floor(Math.random() * (this.canvas.width / this.gridSize));
        const y = Math.floor(Math.random() * (this.canvas.height / this.gridSize));

        return {x, y, type};
    }

    applyPowerup(powerup) {
        if (!this.soundSettings.enabled || this.soundSettings.powerupSound) {
            this.playSound('powerup');
        }

        switch(powerup.type) {
            case 'gold':
                this.score += 50;
                this.combo++;
                this.showPowerupNotification('★ 金色食物 +50分!', true);
                break;
            case 'bomb':
                this.score = Math.max(0, this.score - 20);
                if (this.snake.length > 3) {
                    this.snake.pop();
                    this.snake.pop();
                }
                this.combo = 0;
                this.showPowerupNotification('💣 炸弹! -20分', false);
                break;
            // 加速道具
            case 'car': // 汽车 +1
                this.speed = Math.min(10, this.baseSpeed + 1);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('🚗 汽车! 速度+1', true);
                break;
            case 'train': // 高铁 +2
                this.speed = Math.min(10, this.baseSpeed + 2);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('🚄 高铁! 速度+2', true);
                break;
            case 'plane': // 飞机 +3
                this.speed = Math.min(10, this.baseSpeed + 3);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('✈️ 飞机! 速度+3', true);
                break;
            // 减速道具
            case 'snail': // 蜗牛 -3
                this.speed = Math.max(1, this.baseSpeed - 3);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('🐌 蜗牛! 速度-3', false);
                break;
            case 'koala': // 考拉 -2
                this.speed = Math.max(1, this.baseSpeed - 2);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('🐨 考拉! 速度-2', false);
                break;
            case 'turtle': // 乌龟 -1
                this.speed = Math.max(1, this.baseSpeed - 1);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                this.showPowerupNotification('🐢 乌龟! 速度-1', false);
                break;
            case 'speedDown':
                this.activeEffects.speedDown = true;
                this.speed = Math.max(1, this.baseSpeed - 3);
                document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                setTimeout(() => {
                    this.activeEffects.speedDown = false;
                    this.speed = this.getCurrentSpeed();
                    document.getElementById('current-speed').textContent = this.getCurrentSpeed();
                }, 5000);
                break;
            case 'invincible':
                this.invincibleUses++;
                this.showPowerupNotification('🛡️ 无敌! 可穿墙一次', true);
                break;
            case 'ghost':
                this.ghostUses++;
                this.showPowerupNotification('👻 幽灵! 可穿过自身一次', true);
                break;
        }

        this.checkPowerupAchievements();
    }

    getCurrentSpeed() {
        return this.speed;
    }

    draw() {
        // 清空画布 - 根据背景样式
        switch(this.skinSettings.bgStyle) {
            case 'solid':
                this.ctx.fillStyle = '#ecf0f1';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                break;
            case 'gradient':
                const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
                gradient.addColorStop(0, '#a8edea');
                gradient.addColorStop(1, '#fed6e3');
                this.ctx.fillStyle = gradient;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                break;
            default: // grid
                this.ctx.fillStyle = '#ecf0f1';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                // 绘制网格
                this.ctx.strokeStyle = '#bdc3c7';
                this.ctx.lineWidth = 0.5;
                for (let i = 0; i <= this.canvas.width; i += this.gridSize) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(i, 0);
                    this.ctx.lineTo(i, this.canvas.height);
                    this.ctx.stroke();
                }
                for (let i = 0; i <= this.canvas.height; i += this.gridSize) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, i);
                    this.ctx.lineTo(this.canvas.width, i);
                    this.ctx.stroke();
                }
        }

        // 绘制食物
        this.drawFood(this.food);

        // 绘制道具
        this.powerups.forEach(powerup => {
            this.drawPowerup(powerup);
        });

        // 绘制蛇
        if (this.invincibleUses > 0) {
            // 无敌状态 - 绘制发光效果
            this.ctx.shadowBlur = 15;
            this.ctx.shadowColor = '#ffd700';
        }
        if (this.ghostUses > 0) {
            // 幽灵状态 - 绘制半透明效果
            this.ctx.globalAlpha = 0.6;
        }
        this.drawSnake(this.snake, this.skinSettings.snakeColor);
        this.ctx.shadowBlur = 0;
        this.ctx.globalAlpha = 1;

        // 绘制状态提示
        let statusText = '';
        if (this.invincibleUses > 0) statusText += `🛡️${this.invincibleUses} `;
        if (this.ghostUses > 0) statusText += `👻${this.ghostUses}`;
        if (statusText) {
            this.ctx.fillStyle = '#333';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'left';
            this.ctx.fillText(statusText, 10, 20);
        }

        // 双人模式 - 绘制 P2 蛇
        if (this.isTwoPlayerMode && this.snake2) {
            this.drawSnake(this.snake2, 'blue');
        }
    }

    drawFood(food) {
        const centerX = food.x * this.gridSize + this.gridSize / 2;
        const centerY = food.y * this.gridSize + this.gridSize / 2;

        switch(this.skinSettings.foodStyle) {
            case 'star':
                this.ctx.fillStyle = '#f1c40f';
                this.ctx.font = `${this.gridSize}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('★', centerX, centerY);
                break;
            case 'heart':
                this.ctx.fillStyle = '#e91e63';
                this.ctx.font = `${this.gridSize}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('♥', centerX, centerY);
                break;
            default: // circle
                this.ctx.fillStyle = food.type === 'gold' ? '#f1c40f' : '#e74c3c';
                this.ctx.beginPath();
                this.ctx.arc(centerX, centerY, this.gridSize / 2 - 2, 0, Math.PI * 2);
                this.ctx.fill();
        }
    }

    drawPowerup(powerup) {
        const centerX = powerup.x * this.gridSize + this.gridSize / 2;
        const centerY = powerup.y * this.gridSize + this.gridSize / 2;

        let color, icon;
        switch(powerup.type) {
            case 'gold':
                color = '#f1c40f';
                icon = '★';
                break;
            case 'bomb':
                color = '#2c3e50';
                icon = '💣';
                break;
            // 加速道具
            case 'car':
                color = '#3498db';
                icon = '🚗';
                break;
            case 'train':
                color = '#e74c3c';
                icon = '🚄';
                break;
            case 'plane':
                color = '#9b59b6';
                icon = '✈️';
                break;
            // 减速道具
            case 'snail':
                color = '#8B4513';
                icon = '🐌';
                break;
            case 'koala':
                color = '#7f8c8d';
                icon = '🐨';
                break;
            case 'turtle':
                color = '#27ae60';
                icon = '🐢';
                break;
            case 'invincible':
                color = '#e74c3c';
                icon = '🛡️';
                break;
            case 'ghost':
                color = '#8e44ad';
                icon = '👻';
                break;
        }

        // 绘制背景圆
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, this.gridSize / 2 - 2, 0, Math.PI * 2);
        this.ctx.fill();

        // 绘制图标
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `${this.gridSize * 0.7}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(icon, centerX, centerY);
    }

    drawSnake(snake, colorType) {
        snake.forEach((segment, index) => {
            let fillStyle;

            if (colorType === 'rainbow') {
                const hue = (index * 30) % 360;
                fillStyle = `hsl(${hue}, 70%, 50%)`;
            } else if (colorType === 'blue') {
                fillStyle = index === 0 ? '#2980b9' : '#3498db';
            } else if (colorType === 'red') {
                fillStyle = index === 0 ? '#c0392b' : '#e74c3c';
            } else { // green (default)
                fillStyle = index === 0 ? '#27ae60' : '#2ecc71';
            }

            this.ctx.fillStyle = fillStyle;
            this.ctx.fillRect(
                segment.x * this.gridSize,
                segment.y * this.gridSize,
                this.gridSize - 2,
                this.gridSize - 2
            );
        });
    }

    move() {
        if (!this.isRunning || this.isPaused) return;

        // 移动蛇
        if (this.isTwoPlayerMode) {
            this.moveSnake2();
        } else {
            this.moveSnake1();
        }
    }

    moveSnake1() {
        const head = {...this.snake[0]};
        head.x += this.direction.x;
        head.y += this.direction.y;

        // 无敌效果 - 穿墙
        let passedWall = false;
        if (this.invincibleUses > 0) {
            if (head.x < 0) { head.x = Math.floor(this.canvas.width / this.gridSize) - 1; passedWall = true; }
            if (head.x >= Math.floor(this.canvas.width / this.gridSize)) { head.x = 0; passedWall = true; }
            if (head.y < 0) { head.y = Math.floor(this.canvas.height / this.gridSize) - 1; passedWall = true; }
            if (head.y >= Math.floor(this.canvas.height / this.gridSize)) { head.y = 0; passedWall = true; }
            if (passedWall) this.invincibleUses--;
        } else {
            // 检查边界碰撞
            if (head.x < 0 || head.x >= this.canvas.width / this.gridSize ||
                head.y < 0 || head.y >= this.canvas.height / this.gridSize) {
                this.gameOver();
                return;
            }
        }

        // 检查自身碰撞
        let passedSelf = false;
        for (let i = 0; i < this.snake.length; i++) {
            if (head.x === this.snake[i].x && head.y === this.snake[i].y) {
                if (this.ghostUses > 0) {
                    passedSelf = true;
                    this.ghostUses--;
                } else {
                    this.gameOver();
                    return;
                }
            }
        }

        // 检查食物碰撞
        let ateFood = false;
        if (head.x === this.food.x && head.y === this.food.y) {
            this.handleFoodCollision();
            ateFood = true;
        }

        // 检查道具碰撞
        const powerupIndex = this.powerups.findIndex(p => p.x === head.x && p.y === head.y);
        if (powerupIndex !== -1) {
            this.applyPowerup(this.powerups[powerupIndex]);
            this.powerups.splice(powerupIndex, 1);
            ateFood = true;
        }

        if (!ateFood) {
            this.snake.pop();
        }

        this.snake.unshift(head);
    }

    moveSnake2() {
        // 移动 P1
        const head1 = {...this.snake[0]};
        head1.x += this.direction.x;
        head1.y += this.direction.y;

        // 移动 P2
        const head2 = {...this.snake2[0]};
        head2.x += this.direction2.x;
        head2.y += this.direction2.y;

        // 检查 P1 边界碰撞
        if (head1.x < 0 || head1.x >= this.canvas.width / this.gridSize ||
            head1.y < 0 || head1.y >= this.canvas.height / this.gridSize) {
            this.gameOver('P2');
            return;
        }

        // 检查 P2 边界碰撞
        if (head2.x < 0 || head2.x >= this.canvas.width / this.gridSize ||
            head2.y < 0 || head2.y >= this.canvas.height / this.gridSize) {
            this.gameOver('P1');
            return;
        }

        // 检查 P1 自身碰撞
        for (let i = 0; i < this.snake.length; i++) {
            if (head1.x === this.snake[i].x && head1.y === this.snake[i].y) {
                this.gameOver('P2');
                return;
            }
        }

        // 检查 P2 自身碰撞
        for (let i = 0; i < this.snake2.length; i++) {
            if (head2.x === this.snake2[i].x && head2.y === this.snake2[i].y) {
                this.gameOver('P1');
                return;
            }
        }

        // 检查 P1 和 P2 碰撞
        if (head1.x === head2.x && head1.y === head2.y) {
            // 平局
            this.gameOver('tie');
            return;
        }

        // 检查 P1 和 P2 身体碰撞
        for (let i = 0; i < this.snake.length; i++) {
            if (head2.x === this.snake[i].x && head2.y === this.snake[i].y) {
                this.gameOver('P1');
                return;
            }
        }
        for (let i = 0; i < this.snake2.length; i++) {
            if (head1.x === this.snake2[i].x && head1.y === this.snake2[i].y) {
                this.gameOver('P2');
                return;
            }
        }

        // 检查食物
        let ateFood1 = false, ateFood2 = false;

        if (head1.x === this.food.x && head1.y === this.food.y) {
            this.p1Score += 10;
            document.getElementById('score').textContent = this.p1Score;
            this.food = this.generateFood();
            ateFood1 = true;
        }

        if (head2.x === this.food.x && head2.y === this.food.y) {
            this.p2Score += 10;
            document.getElementById('p2-score').textContent = this.p2Score;
            this.food = this.generateFood();
            ateFood2 = true;
        }

        if (!ateFood1) this.snake.pop();
        if (!ateFood2) this.snake2.pop();

        this.snake.unshift(head1);
        this.snake2.unshift(head2);
    }

    handleFoodCollision() {
        this.score += 10 + this.speed * 2;
        this.combo++;
        this.foodsEaten++;

        document.getElementById('score').textContent = this.score;
        document.getElementById('combo-count').textContent = this.combo;

        if (!this.soundSettings.enabled || this.soundSettings.eatSound) {
            this.playSound('eat');
        }

        this.food = this.generateFood();

        // 无尽模式 - 每吃5个加速
        if (this.isEndlessMode && this.foodsEaten % 5 === 0) {
            this.baseSpeed = Math.min(10, this.baseSpeed + 1);
            this.speed = this.baseSpeed;
            document.getElementById('current-speed').textContent = this.speed;
            document.getElementById('speed-value').textContent = this.speed;
            document.getElementById('game-speed').value = this.speed;
            // 显示加速提示
            this.showSpeedNotification(this.speed);
        }

        // 生成道具 (20% 概率)
        if (document.getElementById('enable-powerups')?.checked && Math.random() < 0.2) {
            this.powerups.push(this.generatePowerup());
            if (this.powerups.length > 3) {
                this.powerups.shift();
            }
        }

        this.checkFoodAchievements();
    }

    update() {
        this.move();
        this.draw();
    }

    gameLoop() {
        if (!this.isRunning || this.isPaused) return;

        this.update();
        this.speedTimer = setTimeout(() => this.gameLoop(), 1000 / this.getCurrentSpeed());
    }

    async start() {
        // 如果游戏正在运行但暂停中，先停止现有游戏再重新开始
        if (this.isRunning) {
            clearInterval(this.gameTimer);
            clearTimeout(this.speedTimer);
        }

        // 游戏开始前先从GitHub获取最新数据
        if (window.auth && window.auth.currentUser) {
            console.log('=== 游戏开始 - 从GitHub加载最新数据 ===');
            await window.auth.syncRecordsFromGitHub();
            this.displayRecords();
            console.log('=== 游戏开始 - 数据加载完成 ===');
        }

        // 重置游戏状态
        const mode = document.getElementById('game-mode').value;

        if (mode === 'battle') {
            this.initTwoPlayerMode();
        } else {
            this.initSinglePlayerMode(mode);
        }

        this.isRunning = true;
        this.isPaused = false;
        this.playerName = document.getElementById('player-name').value || '匿名玩家';

        // 更新UI
        document.getElementById('start-btn').textContent = '重新开始';
        document.getElementById('pause-btn').disabled = false;
        document.getElementById('game-speed').disabled = true;
        document.getElementById('game-mode').disabled = true;

        // 开始游戏循环
        this.gameLoop();

        // 开始计时器 (限时模式)
        if (this.gameTime > 0) {
            this.gameTimer = setInterval(() => {
                this.timeRemaining--;
                document.getElementById('time-remaining').textContent = this.timeRemaining;

                if (!this.isPaused && this.timeRemaining <= 0) {
                    this.gameOver();
                }
            }, 1000);
        }
    }

    initSinglePlayerMode(mode) {
        this.snake = [{x: 10, y: 10}];
        this.direction = {x: 1, y: 0};
        this.food = this.generateFood();
        this.score = 0;
        this.combo = 0;
        this.powerups = [];
        this.activeEffects = {speedUp: false, speedDown: false, invincible: false};
        this.invincibleUses = 0;
        this.ghostUses = 0;
        this.foodsEaten = 0;
        this.isTwoPlayerMode = false;
        this.snake2 = null;

        switch(mode) {
            case 'timed':
                this.gameTime = parseInt(document.getElementById('time-limit').value) || 60;
                this.timeRemaining = this.gameTime;
                this.isEndlessMode = false;
                break;
            case 'endless':
                this.gameTime = 0;
                this.timeRemaining = 0;
                this.isEndlessMode = true;
                break;
            default: // classic
                this.gameTime = parseInt(document.getElementById('game-time').value) || 0;
                this.timeRemaining = this.gameTime;
                this.isEndlessMode = false;
        }

        this.speed = parseInt(document.getElementById('game-speed').value);
        this.baseSpeed = this.speed;

        document.getElementById('score').textContent = '0';
        document.getElementById('combo-count').textContent = '0';
        document.getElementById('time-remaining').textContent = this.timeRemaining;
        document.getElementById('current-speed').textContent = this.speed;
    }

    initTwoPlayerMode() {
        this.isTwoPlayerMode = true;
        this.snake = [{x: 5, y: 12}];
        this.snake2 = [{x: 34, y: 12}];
        this.direction = {x: 1, y: 0};
        this.direction2 = {x: -1, y: 0};
        this.food = this.generateFood();
        this.p1Score = 0;
        this.p2Score = 0;
        this.powerups = [];
        this.gameTime = 0;

        document.getElementById('score').textContent = '0';
        document.getElementById('p2-score').textContent = '0';
    }

    pause() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            document.getElementById('pause-btn').textContent = '继续';
        } else {
            document.getElementById('pause-btn').textContent = '暂停';
            this.gameLoop();
        }
    }

    togglePause() {
        if (this.isRunning) {
            this.pause();
        }
    }

    toggleFullscreen() {
        const container = document.querySelector('.game-container');
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            container.classList.add('fullscreen-mode');
        } else {
            document.exitFullscreen();
            container.classList.remove('fullscreen-mode');
        }
    }

    async gameOver(winner = null) {
        this.isRunning = false;
        this.isPaused = false;

        // 停止计时器
        clearInterval(this.gameTimer);
        clearTimeout(this.speedTimer);

        // 播放音效
        if (!this.soundSettings.enabled || this.soundSettings.gameoverSound) {
            this.playSound('gameover');
        }

        // 更新统计
        this.stats.gamesPlayed++;
        if (this.score >= 100) this.stats.score100 = true;
        if (this.score >= 500) this.stats.score500 = true;
        if (this.score >= 1000) this.stats.score1000 = true;
        if (this.speed >= 10) this.stats.speed10 = true;
        this.saveStats();

        // 检查成就
        this.checkGameOverAchievements();

        // 显示游戏结束
        if (this.isTwoPlayerMode) {
            let message = '';
            if (winner === 'P1') {
                message = `🎉 P1 获胜！\nP1 分数: ${this.p1Score}\nP2 分数: ${this.p2Score}`;
            } else if (winner === 'P2') {
                message = `🎉 P2 获胜！\nP1 分数: ${this.p1Score}\nP2 分数: ${this.p2Score}`;
            } else {
                message = `🤝 平局！\nP1 分数: ${this.p1Score}\nP2 分数: ${this.p2Score}`;
            }
            console.log(message);
        } else {
            console.log(`游戏结束！玩家: ${this.playerName}, 分数: ${this.score}`);
        }

        // 保存记录
        this.saveRecord();
        console.log('=== 游戏结束 - 保存记录完成 ===');

        // 同步到GitHub（如果有登录用户），保存后立即取回最新数据
        const auth = window.auth;
        const currentUser = auth ? auth.currentUser : null;
        if (auth && currentUser) {
            console.log('=== 开始同步到GitHub ===');
            await auth.saveUsers();
            console.log('=== 保存到GitHub完成，开始取回数据 ===');
            await auth.syncRecordsFromGitHub();
            console.log('=== 从GitHub取回数据完成 ===');
            this.displayRecords();
            console.log('=== 显示已刷新 ===');
        } else {
            this.displayRecords();
        }

        // 保存玩家名字
        this.savePlayerName(this.playerName);

        // 重置UI
        document.getElementById('start-btn').textContent = '开始游戏';
        document.getElementById('pause-btn').disabled = true;
        document.getElementById('pause-btn').textContent = '暂停';
        const gameTimeEl = document.getElementById('game-time');
        if (gameTimeEl) gameTimeEl.disabled = false;
        document.getElementById('game-speed').disabled = false;
        document.getElementById('game-mode').disabled = false;
        document.getElementById('time-remaining').textContent = this.gameTime;
        document.getElementById('current-speed').textContent = this.baseSpeed;
    }

    saveRecord() {
        const records = this.loadRecords();
        const topRecords = this.loadTopRecords();
        const currentUser = window.auth ? window.auth.currentUser : null;
        const record = {
            username: currentUser || this.playerName || '匿名',
            playerName: this.isTwoPlayerMode ? (this.p1Score >= this.p2Score ? 'P1' : 'P2') : this.playerName,
            score: this.isTwoPlayerMode ? Math.max(this.p1Score, this.p2Score) : this.score,
            mode: document.getElementById('game-mode').value,
            time: this.gameTime - this.timeRemaining,
            date: new Date().toLocaleString('zh-CN')
        };

        records.push(record);
        records.sort((a, b) => b.score - a.score);
        if (records.length > 50) {
            records.splice(50);
        }

        // 保存前三名到永久记录
        const top3 = records.slice(0, 3);
        top3.forEach(r => {
            if (!topRecords.find(tr => tr.score === r.score && tr.date === r.date)) {
                topRecords.push(r);
            }
        });
        // 去重
        const uniqueTop = [];
        topRecords.forEach(r => {
            if (!uniqueTop.find(tr => tr.score === r.score && tr.date === r.date)) {
                uniqueTop.push(r);
            }
        });
        this.saveTopRecords(uniqueTop);

        this.saveRecords(records);
        this.displayRecords();
    }

    loadTopRecords() {
        const records = localStorage.getItem('snake-top-records');
        return records ? JSON.parse(records) : [];
    }

    saveTopRecords(records) {
        localStorage.setItem('snake-top-records', JSON.stringify(records));
    }

    loadRecords() {
        const records = localStorage.getItem('snake-records');
        return records ? JSON.parse(records) : [];
    }

    // 获取当前用户的记录
    getUserRecords() {
        const allRecords = this.loadRecords();
        const currentUser = window.auth ? window.auth.currentUser : null;
        // 未登录时返回空
        if (!currentUser) return [];
        // 只返回当前用户的记录
        return allRecords.filter(r => r.username === currentUser);
    }

    saveRecords(records) {
        localStorage.setItem('snake-records', JSON.stringify(records));
    }

    savePlayerName(name) {
        if (!name || name === '匿名玩家') return;
        let names = this.loadPlayerNames();
        if (!names.includes(name)) {
            names.unshift(name);
            if (names.length > 10) names.pop();
            localStorage.setItem('snake-player-names', JSON.stringify(names));
            this.updatePlayerNamesDropdown();
        }
    }

    loadPlayerNames() {
        const names = localStorage.getItem('snake-player-names');
        return names ? JSON.parse(names) : [];
    }

    updatePlayerNamesDropdown() {
        const datalist = document.getElementById('player-names');
        const names = this.loadPlayerNames();
        datalist.innerHTML = '';
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }

    displayRecords() {
        // 获取全部记录（包括永久记录）
        const allRecords = this.loadRecords();
        const topRecords = this.loadTopRecords();

        // 合并显示（普通记录 + 永久记录）
        const combinedRecords = [...allRecords];

        // 添加不在普通记录中的永久记录
        topRecords.forEach(tr => {
            if (!combinedRecords.find(r => r.score === tr.score && r.date === tr.date)) {
                combinedRecords.push(tr);
            }
        });

        // 按分数排序
        combinedRecords.sort((a, b) => b.score - a.score);

        const allRecordsList = document.getElementById('records-list-all');
        if (combinedRecords.length === 0) {
            allRecordsList.innerHTML = '<div class="record-item">暂无记录</div>';
        } else {
            allRecordsList.innerHTML = '';
            combinedRecords.slice(0, 10).forEach((record, index) => {
                const recordItem = document.createElement('div');
                recordItem.className = 'record-item';
                if (index < 3) recordItem.classList.add('highlight');

                const modeName = {
                    'classic': '经典',
                    'timed': '限时',
                    'endless': '无尽',
                    'battle': '对战'
                }[record.mode] || '经典';

                const username = record.username || record.playerName || '匿名';

                // 检查是否是永久记录
                const isTop = topRecords.find(tr => tr.score === record.score && tr.date === record.date);
                const badge = isTop ? ' 🏆' : '';

                recordItem.innerHTML = `
                    <strong>${username}${badge}</strong> - <span style="color:#667eea;">${modeName}</span><br>
                    分数: ${record.score} | 时间: ${record.time}s | ${record.date}
                `;
                allRecordsList.appendChild(recordItem);
            });
        }

        // 显示当前用户记录
        const myRecords = this.getUserRecords();
        const myRecordsList = document.getElementById('records-list-mine');
        if (myRecords.length === 0) {
            myRecordsList.innerHTML = '<div class="record-item">暂无记录</div>';
        } else {
            myRecordsList.innerHTML = '';
            myRecords.forEach((record, index) => {
                const recordItem = document.createElement('div');
                recordItem.className = 'record-item';
                if (index < 3) recordItem.classList.add('highlight');

                const modeName = {
                    'classic': '经典',
                    'timed': '限时',
                    'endless': '无尽',
                    'battle': '对战'
                }[record.mode] || '经典';

                const username = record.username || record.playerName || '匿名';

                // 检查是否是永久记录
                const isTop = topRecords.find(tr => tr.score === record.score && tr.date === record.date);
                const badge = isTop ? ' 🏆' : '';

                recordItem.innerHTML = `
                    <strong>${username}${badge}</strong> - <span style="color:#667eea;">${modeName}</span><br>
                    分数: ${record.score} | 时间: ${record.time}s | ${record.date}
                `;
                myRecordsList.appendChild(recordItem);
            });
        }
    }

    async clearRecords() {
        // 获取当前用户名
        const currentUser = window.auth ? window.auth.currentUser : null;
        const playerName = document.getElementById('player-name').value;
        const userToDelete = currentUser || playerName;

        if (!userToDelete) {
            alert('请先登录或输入玩家姓名');
            return;
        }

        // 确认一次即可
        if (!confirm('确定要清除「' + userToDelete + '」的所有游戏记录吗？')) {
            return;
        }

        const allRecords = this.loadRecords();

        // 删除该用户的记录
        const filteredRecords = allRecords.filter(r => {
            return (r.username !== userToDelete) && (r.playerName !== userToDelete);
        });

        this.saveRecords(filteredRecords);

        // 同步到GitHub
        if (window.auth && window.auth.currentUser) {
            await window.auth.saveUsers();
            await window.auth.syncRecordsFromGitHub();
        }

        this.displayRecords();
    }

    // 初始化记录标签页（保留兼容）
    initRecordTabs() {
        // 不再需要标签页，两列显示
    }

    // 成就系统
    loadAchievements() {
        const defaultAchievements = {
            firstFood: {name: '初试身手', desc: '首次吃到食物', icon: '🍎', unlocked: false},
            combo10: {name: '连击达人', desc: '连续吃10个食物', icon: '🔥', unlocked: false},
            score100: {name: '初露头角', desc: '突破100分', icon: '⭐', unlocked: false},
            score500: {name: '高分选手', desc: '突破500分', icon: '🌟', unlocked: false},
            score1000: {name: '大神级别', desc: '突破1000分', icon: '👑', unlocked: false},
            speed10: {name: '速度之王', desc: '速度达到10级', icon: '⚡', unlocked: false},
            games10: {name: '小试牛刀', desc: '完成10局游戏', icon: '🎮', unlocked: false},
            games50: {name: '资深玩家', desc: '完成50局游戏', icon: '🏆', unlocked: false},
            games100: {name: '传奇人物', desc: '完成100局游戏', icon: '🏅', unlocked: false}
        };

        const currentUser = window.auth ? window.auth.currentUser : null;
        const storageKey = currentUser ? `snake-achievements-${currentUser}` : 'snake-achievements';
        const saved = localStorage.getItem(storageKey);
        return saved ? JSON.parse(saved) : defaultAchievements;
    }

    saveAchievements() {
        const currentUser = window.auth ? window.auth.currentUser : null;
        const storageKey = currentUser ? `snake-achievements-${currentUser}` : 'snake-achievements';
        localStorage.setItem(storageKey, JSON.stringify(this.achievements));
    }

    showAchievementNotification(achievement) {
        const notification = document.getElementById('achievement-notification');
        notification.textContent = `🏆 ${achievement.name} - ${achievement.desc}`;
        notification.classList.remove('show');
        // 重新触发动画
        void notification.offsetWidth;
        notification.classList.add('show');
    }

    showSpeedNotification(speed) {
        const notification = document.getElementById('achievement-notification');
        notification.textContent = `⚡ 速度提升! 当前速度: ${speed}`;
        notification.classList.remove('show', 'speed');
        void notification.offsetWidth;
        notification.classList.add('show', 'speed');
    }

    showPowerupNotification(text, isGood) {
        const notification = document.getElementById('achievement-notification');
        notification.textContent = text;
        notification.classList.remove('show', 'speed');
        if (!isGood) {
            notification.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
            notification.style.color = 'white';
        } else {
            notification.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffed4a 100%)';
            notification.style.color = '#333';
        }
        void notification.offsetWidth;
        notification.classList.add('show');
    }

    checkFoodAchievements() {
        // 首次吃到食物
        if (!this.achievements.firstFood.unlocked) {
            this.achievements.firstFood.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.firstFood);
        }

        // 连击10个
        if (!this.achievements.combo10.unlocked && this.combo >= 10) {
            this.achievements.combo10.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.combo10);
        }

        // 分数成就
        if (!this.achievements.score100.unlocked && this.score >= 100) {
            this.achievements.score100.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.score100);
        }
        if (!this.achievements.score500.unlocked && this.score >= 500) {
            this.achievements.score500.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.score500);
        }
        if (!this.achievements.score1000.unlocked && this.score >= 1000) {
            this.achievements.score1000.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.score1000);
        }

        this.saveAchievements();
    }

    checkPowerupAchievements() {
        // 可以添加道具相关成就
    }

    checkGameOverAchievements() {
        // 速度10级
        if (!this.achievements.speed10.unlocked && this.speed >= 10) {
            this.achievements.speed10.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.speed10);
        }

        // 游戏局数
        if (!this.achievements.games10.unlocked && this.stats.gamesPlayed >= 10) {
            this.achievements.games10.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.games10);
        }
        if (!this.achievements.games50.unlocked && this.stats.gamesPlayed >= 50) {
            this.achievements.games50.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.games50);
        }
        if (!this.achievements.games100.unlocked && this.stats.gamesPlayed >= 100) {
            this.achievements.games100.unlocked = true;
            this.playSound('achievement');
            this.showAchievementNotification(this.achievements.games100);
        }

        this.saveAchievements();
    }

    loadStats() {
        const currentUser = window.auth ? window.auth.currentUser : null;
        const storageKey = currentUser ? `snake-stats-${currentUser}` : 'snake-stats';
        const saved = localStorage.getItem(storageKey);
        return saved ? JSON.parse(saved) : {gamesPlayed: 0, score100: false, score500: false, score1000: false, speed10: false};
    }

    saveStats() {
        const currentUser = window.auth ? window.auth.currentUser : null;
        const storageKey = currentUser ? `snake-stats-${currentUser}` : 'snake-stats';
        localStorage.setItem(storageKey, JSON.stringify(this.stats));
    }

    showAchievements() {
        const panel = document.getElementById('achievements-panel');
        const list = document.getElementById('achievements-list');

        list.innerHTML = '';
        Object.values(this.achievements).forEach(achievement => {
            const card = document.createElement('div');
            card.className = `achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'}`;
            card.innerHTML = `
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-name">${achievement.name}</div>
                <div class="achievement-desc">${achievement.desc}</div>
                <div class="achievement-status ${achievement.unlocked ? 'unlocked' : 'locked'}">
                    ${achievement.unlocked ? '✓ 已解锁' : '🔒 未解锁'}
                </div>
            `;
            list.appendChild(card);
        });

        panel.classList.add('show');
    }

    // 皮肤系统
    loadSkinSettings() {
        const saved = localStorage.getItem('snake-skins');
        return saved ? JSON.parse(saved) : {
            snakeColor: 'green',
            foodStyle: 'circle',
            bgStyle: 'grid'
        };
    }

    saveSkins() {
        const snakeColor = document.querySelector('input[name="snake-color"]:checked').value;
        const foodStyle = document.querySelector('input[name="food-style"]:checked').value;
        const bgStyle = document.querySelector('input[name="bg-style"]:checked').value;

        this.skinSettings = {snakeColor, foodStyle, bgStyle};
        localStorage.setItem('snake-skins', JSON.stringify(this.skinSettings));

        document.getElementById('skins-panel').classList.remove('show');
        this.draw();
    }

    showSkins() {
        // 设置当前选中
        document.querySelector(`input[name="snake-color"][value="${this.skinSettings.snakeColor}"]`).checked = true;
        document.querySelector(`input[name="food-style"][value="${this.skinSettings.foodStyle}"]`).checked = true;
        document.querySelector(`input[name="bg-style"][value="${this.skinSettings.bgStyle}"]`).checked = true;

        document.getElementById('skins-panel').classList.add('show');
    }

    // 音效系统
    loadSoundSettings() {
        const saved = localStorage.getItem('snake-sounds');
        return saved ? JSON.parse(saved) : {
            enabled: true,
            bgmEnabled: false,
            eatSound: true,
            powerupSound: true,
            gameoverSound: true
        };
    }

    saveSoundSettings() {
        this.soundSettings = {
            enabled: document.getElementById('sound-enabled').checked,
            bgmEnabled: document.getElementById('bgm-enabled').checked,
            eatSound: document.getElementById('eat-sound').checked,
            powerupSound: document.getElementById('powerup-sound').checked,
            gameoverSound: document.getElementById('gameover-sound').checked
        };
        localStorage.setItem('snake-sounds', JSON.stringify(this.soundSettings));

        document.getElementById('sound-panel').classList.remove('show');
    }

    showSoundSettings() {
        document.getElementById('sound-enabled').checked = this.soundSettings.enabled;
        document.getElementById('bgm-enabled').checked = this.soundSettings.bgmEnabled;
        document.getElementById('eat-sound').checked = this.soundSettings.eatSound;
        document.getElementById('powerup-sound').checked = this.soundSettings.powerupSound;
        document.getElementById('gameover-sound').checked = this.soundSettings.gameoverSound;

        document.getElementById('sound-panel').classList.add('show');
    }
}
