// 贪吃蛇游戏核心逻辑 - 增强版
// 版本: 1.3.3 (2026-03-19)
// 更新日志:
// 1.3.3 - 修复非触摸屏全屏时显示虚拟控制键
// 1.3.2 - 优化分页显示（首页尾页、省略号）
// 1.3.1 - 添加按Enter键确认修改密码
// 1.3.0 - 修复修改密码按钮和输入框ID冲突问题
// 1.2.0 - 添加敏感词过滤功能
// 1.1.0 - 添加Firebase云端同步
// 1.0.0 - 初始版本

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

// EmailJS 配置 - 优先使用管理员保存的配置
function getEmailJSConfig() {
    // 优先从 localStorage 读取管理员保存的配置
    const savedConfig = localStorage.getItem('snake-emailjs-config');
    console.log('localStorage raw value:', savedConfig);
    if (savedConfig) {
        try {
            const parsed = JSON.parse(savedConfig);
            console.log('parsed config:', parsed);
            if (parsed.publicKey && parsed.serviceId && parsed.templateId) {
                console.log('使用已保存的 EmailJS 配置');
                return parsed;
            }
        } catch (e) {
            console.error('解析 EmailJS 配置失败:', e);
        }
    }
    // 如果没有保存的配置，返回默认配置
    return {
        publicKey: 'LsNvV4SDNGLYE7PuD',
        serviceId: 'service_mm0l2m5',
        templateId: 'template_vmv2xvo'
    };
}

// 预配置的 EmailJS 配置（用于内存中快速访问）
let EMAILJS_CONFIG = {
    publicKey: 'LsNvV4SDNGLYE7PuD',
    serviceId: 'service_mm0l2m5',
    templateId: 'template_vmv2xvo'
};

// 修复 admin 邮箱（仅当用户未设置时）
if (typeof localStorage !== 'undefined') {
    try {
        const users = JSON.parse(localStorage.getItem('snake-users') || '{}');
        if (users['admin'] && !users['admin'].email) {
            users['admin'].email = 'acientemple@gmail.com';
            localStorage.setItem('snake-users', JSON.stringify(users));
            console.log('已修复 admin 邮箱');

            // 同步到 Firebase
            if (typeof firebase !== 'undefined') {
                firebase.database().ref('users').set(users).then(() => {
                    console.log('admin 邮箱已同步到 Firebase');
                }).catch(err => console.log('同步失败:', err));
            }
        }
    } catch(e) {}
}

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
            // 使用共享 Token（从 localStorage）
            token = localStorage.getItem('snake-shared-github-token');
        }
        return token;
    }

    // 从公开链接获取 Token（管理员可配置）
    async fetchTokenFromPublicURL() {
        const publicConfigUrl = 'https://acientemple.github.io/snake-game/token-config.json';
        console.log('尝试从公开链接获取 Token...', publicConfigUrl);

        try {
            const response = await fetch(publicConfigUrl);
            console.log('公开链接响应状态:', response.status);
            if (response.ok) {
                const config = await response.json();
                console.log('获取到的配置:', config);
                if (config.sharedToken) {
                    let token = config.sharedToken;
                    // 尝试 Base64 解码
                    try {
                        const decoded = atob(config.sharedToken);
                        // 验证解码后是否像 Token（以 ghp_ 开头）
                        if (decoded.startsWith('ghp_')) {
                            token = decoded;
                            console.log('Token Base64 解码成功');
                        } else if (decoded.includes('"sharedToken"')) {
                            // 如果解码后是 JSON 格式，解析它
                            try {
                                const innerConfig = JSON.parse(decoded);
                                if (innerConfig.sharedToken && innerConfig.sharedToken.startsWith('ghp_')) {
                                    token = innerConfig.sharedToken;
                                    console.log('Token 双重解码成功');
                                }
                            } catch(e) {}
                        }
                    } catch(e) {
                        console.log('Token 不是 Base64 编码，使用原始值');
                    }
                    localStorage.setItem('snake-shared-github-token', token);
                    if (config.sharedUser) {
                        localStorage.setItem('snake-shared-github-user', config.sharedUser);
                    }
                    console.log('从公开链接获取 Token 成功');
                    return true;
                }
            }
        } catch(e) {
            console.log('从公开链接获取 Token 失败:', e.message);
        }
        return false;
    }

    // 从 GitHub Gist 获取共享 Token 配置
    async fetchSharedTokenConfig() {
        console.log('尝试从 GitHub 获取共享 Token 配置...');

        // 尝试使用已知的 gist ID 或搜索
        const gistId = localStorage.getItem('snake-users-gist-id');
        const searchToken = localStorage.getItem('snake-github-token') ||
                           localStorage.getItem('snake-shared-github-token');

        // 如果没有任何 token，无法访问 GitHub
        if (!searchToken) {
            console.log('没有可用 Token，无法从 GitHub 获取配置');
            return;
        }

        try {
            let targetGistId = gistId;

            // 如果没有 gistId，尝试查找
            if (!targetGistId) {
                const listResponse = await fetch('https://api.github.com/gists', {
                    headers: {
                        'Authorization': `token ${searchToken}`,
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

            if (!targetGistId) {
                console.log('未找到 Gist');
                return;
            }

            // 获取 Gist 内容
            const gistResponse = await fetch(`https://api.github.com/gists/${targetGistId}`, {
                headers: {
                    'Authorization': `token ${searchToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (gistResponse.ok) {
                const gist = await gistResponse.json();
                const configContent = gist.files['snake-config.json']?.content;

                if (configContent) {
                    const config = JSON.parse(configContent);
                    if (config.sharedToken) {
                        console.log('从 GitHub 获取到共享 Token');
                        // Token 使用 Base64 编码，读取后需要解码
                        try {
                            localStorage.setItem('snake-shared-github-token', atob(config.sharedToken));
                        } catch(e) {
                            // 如果解码失败，直接使用原始值（兼容旧版本）
                            localStorage.setItem('snake-shared-github-token', config.sharedToken);
                        }
                        if (config.sharedUser) {
                            localStorage.setItem('snake-shared-github-user', config.sharedUser);
                        }
                    }
                }
            }
        } catch (e) {
            console.log('从 GitHub 获取共享 Token 失败:', e.message);
        }
    }

    // 初始化方法，在 DOM 加载完成后调用
    async initAuth() {
        console.log('=== 开始初始化认证系统 (Firebase) ===');
        console.log('游戏版本: 1.3.3 (2026-03-19)');

        // 加载敏感词（从Firebase同步）
        await this.loadBadWordsFromFirebase();

        // 加载本地用户数据
        this.users = this.loadUsers();
        console.log('本地用户数:', Object.keys(this.users).length);

        // 创建默认管理员账号（如果不存在）
        const adminUsername = 'admin';
        const adminPassword = '801228';
        const adminEmail = 'acientemple@gmail.com';
        if (!this.users[adminUsername]) {
            console.log('创建默认管理员账号');
            this.users[adminUsername] = {
                password: simpleHash(adminPassword),
                email: adminEmail,
                created: new Date().toISOString(),
                data: { isAdmin: true },
                isAdmin: true
            };
            // 保存到 Firebase
            this.saveUsers();
        } else {
            // 确保管理员有 isAdmin 标记和邮箱
            this.users[adminUsername].isAdmin = true;
            this.users[adminUsername].email = adminEmail;
            this.users[adminUsername].data = this.users[adminUsername].data || {};
            this.users[adminUsername].data.isAdmin = true;
            // 保存到 Firebase
            this.saveUsers();
        }

        // 从 Firebase 加载最新用户数据
        console.log('从 Firebase 加载用户数据...');
        await this.loadUsersFromFirebase();

        // 检查是否已登录
        if (this.isLoggedIn()) {
            console.log('已自动登录: ' + this.currentUser);
            // 登录状态下从 Firebase 加载游戏记录
            await this.loadRecordsFromFirebase();
        }

        console.log('=== 初始化完成 ===');
        this.init();
    }

    // 从 Firebase 加载用户数据
    loadUsersFromFirebase() {
        return new Promise((resolve) => {
            firebase.database().ref('users').once('value', (snapshot) => {
                const firebaseUsers = snapshot.val() || {};
                console.log('Firebase 用户数:', Object.keys(firebaseUsers).length);

                if (Object.keys(firebaseUsers).length > 0) {
                    // 合并 Firebase 用户和本地用户
                    this.users = { ...this.users, ...firebaseUsers };
                    localStorage.setItem('snake-users', JSON.stringify(this.users));
                    console.log('合并后用户数:', Object.keys(this.users).length);
                }
                resolve();
            }, (error) => {
                console.log('从 Firebase 加载用户失败:', error.message);
                resolve();
            });
        });
    }

    // 从 Firebase 加载游戏记录
    loadRecordsFromFirebase() {
        return new Promise((resolve) => {
            const currentUser = this.currentUser;
            if (!currentUser) {
                resolve();
                return;
            }

            firebase.database().ref('records').once('value', (snapshot) => {
                const records = snapshot.val() || [];
                localStorage.setItem('snake-records', JSON.stringify(records));
                console.log('从 Firebase 加载了', records.length, '条记录');
                resolve();
            }, (error) => {
                console.log('从 Firebase 加载记录失败:', error.message);
                resolve();
            });
        });
    }

    // 强制刷新用户数据（从 GitHub，合并到本地）
    async refreshUsers() {
        const githubToken = this.getGitHubToken();
        if (githubToken) {
            // 先加载本地用户
            const localUsers = this.loadUsers();
            console.log('refreshUsers: 本地用户数:', Object.keys(localUsers).length);

            // 再从 GitHub 加载
            const githubUsers = await this.loadUsersFromGitHub(githubToken, null);
            if (githubUsers && Object.keys(githubUsers).length > 0) {
                // 合并用户数据
                this.users = { ...localUsers, ...githubUsers };
                localStorage.setItem('snake-users', JSON.stringify(this.users));
                console.log('已合并GitHub用户数据, 总用户数:', Object.keys(this.users).length);
            } else {
                // 如果 GitHub 没有数据，使用本地数据
                this.users = localUsers;
                console.log('GitHub 无数据，使用本地用户');
            }
        }
    }

    // 登录后从 GitHub 加载用户和记录数据
    async loadFromGitHubOnLogin() {
        const githubToken = this.getGitHubToken();
        if (!githubToken) {
            console.log('loadFromGitHubOnLogin: 没有 GitHub Token');
            return;
        }

        console.log('loadFromGitHubOnLogin: 开始加载...');
        try {
            let gistId = localStorage.getItem('snake-users-gist-id');

            // 如果没有 gistId，尝试查找
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

            if (!gistId) {
                console.log('loadFromGitHubOnLogin: 未找到 Gist');
                return;
            }

            // 获取 Gist 内容
            const gistResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (gistResponse.ok) {
                const gist = await gistResponse.json();

                // 加载用户数据
                const cloudUsers = gist.files['snake-users.json']?.content;
                if (cloudUsers) {
                    this.users = JSON.parse(cloudUsers);
                    localStorage.setItem('snake-users', cloudUsers);
                    console.log('登录时从GitHub加载用户:', Object.keys(this.users).length);
                }

                // 加载记录数据
                const cloudRecords = gist.files['snake-records.json']?.content || '[]';
                localStorage.setItem('snake-records', cloudRecords);
                console.log('登录时从GitHub加载记录:', JSON.parse(cloudRecords).length);

                // 刷新显示
                if (this.displayRecords) {
                    this.displayRecords();
                }
            }
        } catch (e) {
            console.error('loadFromGitHubOnLogin 失败:', e);
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
    async sendPasswordResetEmail(email, username, resetCode) {
        console.log('===== 发送邮件调试 =====');
        console.log('收件人邮箱:', email);
        console.log('用户名:', username);
        console.log('验证码:', resetCode);

        const config = getEmailJSConfig();
        console.log('EmailJS 配置:', config);
        console.log('emailjs 对象:', typeof emailjs);

        if (!config || !config.publicKey) {
            alert('EmailJS 未配置，无法发送邮件。请联系管理员。');
            return false;
        }

        if (typeof emailjs === 'undefined') {
            alert('邮件服务加载失败，请刷新页面后重试。');
            return false;
        }

        // EmailJS 参数
        const templateParams = {
            to_email: email,
            to_name: username,
            reset_code: resetCode
        };
        console.log('发送参数:', templateParams);

        try {
            // 初始化 EmailJS
            console.log('初始化 EmailJS with publicKey:', config.publicKey);
            emailjs.init(config.publicKey);
            console.log('EmailJS 初始化完成');

            // 发送邮件 - 使用 sendForm 方式
            console.log('准备发送邮件...');
            console.log('serviceId:', config.serviceId);
            console.log('templateId:', config.templateId);
            console.log('收件人:', email);

            // 创建一个隐藏的表单来发送
            const form = document.createElement('form');
            form.style.display = 'none';
            form.setAttribute('id', 'emailjs-temp-form');

            // 添加参数 - 使用正确的变量名
            const params = {
                to_name: username,
                to_email: email,
                email: email,
                reset_code: resetCode
            };
            console.log('邮件参数:', params);

            // 直接使用 send 方法发送
            const response = await emailjs.send(
                config.serviceId,
                config.templateId,
                params
            );
            console.log('邮件发送成功:', response);
            alert('验证码已发送到您的邮箱: ' + email);
            return true;
        } catch (error) {
            console.error('邮件发送失败详细:', error);
            // 尝试获取更详细的错误信息
            let errorMsg = '未知错误';
            if (error.message) {
                errorMsg = error.message;
            } else if (error.text) {
                errorMsg = error.text;
            } else if (typeof error === 'string') {
                errorMsg = error;
            }
            alert('邮件发送失败: ' + errorMsg + '，请检查 EmailJS 配置是否正确');
            return false;
        }
    }

    loadUsers() {
        // 从本地加载（登录时已从Firebase同步）
        const users = localStorage.getItem('snake-users');
        return users ? JSON.parse(users) : {};
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

        // 同时保存到 Firebase（合并现有用户后保存）
        try {
            firebase.database().ref('users').once('value', (snapshot) => {
                const firebaseUsers = snapshot.val() || {};
                // 合并本地用户和 Firebase 用户
                const mergedUsers = { ...firebaseUsers, ...this.users };
                firebase.database().ref('users').set(mergedUsers);
                console.log('用户数据已保存到 Firebase (合并后)');
            });
        } catch (e) {
            console.log('保存到 Firebase 失败:', e.message);
        }

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

    // 保存共享 Token 到 GitHub
    async saveSharedTokenToGitHub(token, username) {
        const githubToken = token;
        if (!githubToken) return;

        try {
            // 查找现有 Gist
            const listResponse = await fetch('https://api.github.com/gists', {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            let existingGistId = null;
            let cloudUsers = {};
            let cloudRecords = '[]';
            let cloudTopRecords = '[]';

            if (listResponse.ok) {
                const gists = await listResponse.json();
                const existingGist = gists.find(g => g.description === 'Snake Game Users Data');
                if (existingGist) {
                    existingGistId = existingGist.id;

                    // 获取现有 Gist 内容
                    const gistResponse = await fetch(`https://api.github.com/gists/${existingGistId}`, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (gistResponse.ok) {
                        const gist = await gistResponse.json();
                        cloudUsers = JSON.parse(gist.files['snake-users.json']?.content || '{}');
                        cloudRecords = gist.files['snake-records.json']?.content || '[]';
                        cloudTopRecords = gist.files['snake-top-records.json']?.content || '[]';
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
                    },
                    'snake-config.json': {
                        content: JSON.stringify({
                            sharedToken: token,
                            sharedUser: username
                        }, null, 2)
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
                console.log('共享 Token 已保存到 GitHub');
            }
        } catch (e) {
            console.log('保存共享 Token 失败', e);
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
        console.log('adminDeleteUser called for:', username);
        console.log('isAdmin:', this.isAdmin);
        console.log('users before delete:', this.users);
        if (!this.isAdmin) {
            alert('无权限');
            return { success: false, message: '无权限' };
        }
        if (username === 'admin') {
            alert('不能删除默认管理员');
            return { success: false, message: '不能删除默认管理员' };
        }
        if (!this.users[username]) {
            alert('用户不存在');
            return { success: false, message: '用户不存在' };
        }
        if (!confirm(`确定要删除用户 "${username}" 吗？`)) {
            return { success: false, message: '已取消' };
        }
        delete this.users[username];
        console.log('users after delete:', this.users);
        this.saveUsers();

        // 刷新管理面板显示
        this.loadAdminData();

        alert('用户已删除');
        return { success: true, message: '用户已删除' };
    }

    // 设为管理员
    adminSetAdmin(username) {
        if (!this.isAdmin) {
            alert('无权限');
            return;
        }
        if (!this.users[username]) {
            alert('用户不存在');
            return;
        }
        if (!confirm(`确定要将 "${username}" 设为管理员吗？`)) {
            return;
        }
        this.users[username].isAdmin = true;
        this.users[username].data = this.users[username].data || {};
        this.users[username].data.isAdmin = true;
        this.saveUsers();
        this.loadAdminData();
        alert('已设置为管理员');
    }

    // 取消管理员
    adminRemoveAdmin(username) {
        if (!this.isAdmin) {
            alert('无权限');
            return;
        }
        if (username === 'admin') {
            alert('不能取消默认管理员的权限');
            return;
        }
        if (!this.users[username]) {
            alert('用户不存在');
            return;
        }
        if (!confirm(`确定要取消 "${username}" 的管理员权限吗？`)) {
            return;
        }
        this.users[username].isAdmin = false;
        if (this.users[username].data) {
            this.users[username].data.isAdmin = false;
        }
        this.saveUsers();
        this.loadAdminData();
        alert('已取消管理员权限');
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

        if (!username || username === '游客') {
            return { success: false, message: '请先登录' };
        }

        if (newPassword.length < 3) {
            return { success: false, message: '新密码至少3位' };
        }

        const self = this;

        // 从Firebase验证密码并修改
        return new Promise((resolve) => {
            firebase.database().ref('users').once('value', (snapshot) => {
                const users = snapshot.val() || {};
                const user = users[username];

                if (!user) {
                    resolve({ success: false, message: '用户不存在' });
                    return;
                }

                if (user.password !== simpleHash(oldPassword)) {
                    resolve({ success: false, message: '原密码错误' });
                    return;
                }

                // 更新Firebase密码
                firebase.database().ref('users/' + username + '/password').set(simpleHash(newPassword))
                    .then(() => {
                        // 同时更新本地存储
                        if (self.users[username]) {
                            self.users[username].password = simpleHash(newPassword);
                            self.saveUsers();
                        }
                        resolve({ success: true, message: '密码修改成功' });
                    })
                    .catch(() => {
                        resolve({ success: false, message: '密码修改失败' });
                    });
            }, (error) => {
                resolve({ success: false, message: '读取用户数据失败: ' + error.message });
            });
        });
    }

    // 显示修改密码/邮箱对话框
    showChangePasswordDialog() {
        const username = this.currentUser;
        const currentEmail = this.users[username]?.email || '';

        // 创建弹窗
        const dialog = document.createElement('div');
        dialog.id = 'change-password-dialog';
        dialog.className = 'modal show';
        dialog.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <span class="close" onclick="document.getElementById('change-password-dialog').remove()">&times;</span>
                <h3>账号设置</h3>
                <label style="display:block;margin:10px 0;font-weight:bold;">邮箱</label>
                <input type="email" id="change-email" placeholder="用于找回密码" value="${currentEmail}" style="width:100%;padding:12px;margin:5px 0;border:2px solid #ddd;border-radius:8px;">
                <button id="confirm-change-email" class="auth-btn" style="background:#3498db;margin-bottom:15px;">保存邮箱</button>
                <hr style="margin:15px 0;">
                <label style="display:block;margin:10px 0;font-weight:bold;">修改密码</label>
                <input type="password" id="cp-old-password" placeholder="原密码" style="width:100%;padding:12px;margin:5px 0;border:2px solid #ddd;border-radius:8px;">
                <input type="password" id="cp-new-password" placeholder="新密码（至少3位）" style="width:100%;padding:12px;margin:5px 0;border:2px solid #ddd;border-radius:8px;">
                <input type="password" id="cp-confirm-password" placeholder="确认新密码" style="width:100%;padding:12px;margin:5px 0;border:2px solid #ddd;border-radius:8px;">
                <button id="confirm-change-pass" class="auth-btn">确认修改密码</button>
            </div>
        `;

        document.body.appendChild(dialog);

        // 保存邮箱 - 使用onclick
        const self = this;
        document.getElementById('confirm-change-email').onclick = function() {
            const newEmail = document.getElementById('change-email').value.trim();
            if (newEmail && !newEmail.includes('@')) {
                alert('请输入有效的邮箱地址');
                return;
            }
            self.users[username].email = newEmail;
            self.saveUsers();
            alert('邮箱保存成功！');
        };

        // 修改密码 - 使用onclick
        // 按 Enter 键确认
        const handleEnter = function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                document.getElementById('confirm-change-pass').click();
            }
        };
        document.getElementById('cp-old-password').addEventListener('keydown', handleEnter);
        document.getElementById('cp-new-password').addEventListener('keydown', handleEnter);
        document.getElementById('cp-confirm-password').addEventListener('keydown', handleEnter);

        document.getElementById('confirm-change-pass').onclick = function() {
            const oldPass = document.getElementById('cp-old-password').value;
            const newPass = document.getElementById('cp-new-password').value;
            const confirmPass = document.getElementById('cp-confirm-password').value;

            if (!oldPass) {
                alert('请输入原密码');
                return;
            }
            if (newPass.length < 3) {
                alert('新密码至少3位');
                return;
            }
            if (newPass !== confirmPass) {
                alert('两次输入的新密码不一致');
                return;
            }

            self.changePassword(oldPass, newPass).then(function(result) {
                if (result.success) {
                    alert('密码修改成功！');
                    document.getElementById('change-password-dialog').remove();
                } else {
                    alert(result.message);
                }
            }).catch(function(err) {
                alert('修改密码失败: ' + err.message);
            });
        };
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

        // 检查是否是管理员
        const isAdmin = user.isAdmin || (user.data && user.data.isAdmin);
        this.isAdmin = isAdmin;
        localStorage.setItem('snake-admin', isAdmin ? 'true' : 'false');

        return { success: true, message: '登录成功' };
    }

    logout() {
        // 登出前保存当前游戏数据到 Firebase
        const currentUser = this.currentUser;
        if (currentUser) {
            // 保存记录
            const records = localStorage.getItem('snake-records');
            if (records) {
                firebase.database().ref('records').set(JSON.parse(records))
                    .then(() => console.log('登出前保存记录到 Firebase'))
                    .catch(e => console.log('保存记录失败:', e.message));
            }

            // 保存最高记录
            const topRecords = localStorage.getItem('snake-top-records');
            if (topRecords) {
                const topRecordsObj = {};
                JSON.parse(topRecords).forEach((r, i) => {
                    topRecordsObj['-' + Date.now() + i] = r;
                });
                firebase.database().ref('topRecords').set(topRecordsObj)
                    .then(() => console.log('登出前保存最高记录到 Firebase'))
                    .catch(e => console.log('保存最高记录失败:', e.message));
            }

            // 保存成就
            const achievements = localStorage.getItem('snake-achievements-' + currentUser);
            if (achievements) {
                firebase.database().ref('achievements/' + currentUser).set(JSON.parse(achievements))
                    .then(() => console.log('登出前保存成就到 Firebase'))
                    .catch(e => console.log('保存成就失败:', e.message));
            }

            console.log('用户 ' + currentUser + ' 登出，数据已保存');
        }

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

    // 检查玩家姓名是否与已注册用户名冲突（排除当前用户自己）
    checkPlayerNameConflict(playerName) {
        if (!playerName || playerName.trim() === '') return false;
        const name = playerName.trim();
        // 检查是否与已注册用户名冲突（不包括当前登录用户自己）
        for (const username in this.users) {
            if (username !== this.currentUser && username === name) {
                return true; // 冲突
            }
        }
        return false; // 不冲突
    }

    // 获取敏感词列表
    getBadWords() {
        const defaultBadWords = ['傻逼', '傻B', 'SB', '傻b', '傻B', '操', '麻痹', '妈逼', '滚蛋', '去死', '废物', '蠢货', '阳痿', '早泄', '婊子', '妓女', '贱人', '贱货', '狗屎', '垃圾', '笨蛋', '白痴', '智障', '丑八怪', '长得丑', '丑逼', '臭不要脸', '不要脸', '神经病', '精神病', '疯子', '变态', '人渣', '王八', '乌龟', '王八蛋', '龟儿子', '杂种', '野种', '死全家', '全家死光', '断子绝孙', '不得好死', '天打雷劈', '遭雷劈', '下地狱', '畜生', '禽兽', '恶心', '丑陋', '难看', '恶心吧啦', '恶臭', '臭虫', '蛀虫', '寄生虫', '吸血鬼', '败类', '恶棍', '恶霸', '土匪', '强盗', '骗子', '无赖', '痞子', '地痞', '流氓', '痞子', '无赖', '赖皮', '不要脸', '厚颜无耻', '恬不知耻', '臭名昭著', '臭名远扬', '遗臭万年', '臭烘烘', '脏东西', '污秽', '污浊', '腐烂', '腐臭', '腐朽', '腐败', '腐化', '腐蚀', '侵蚀', '腐朽', '腐肉', '腐尸',
            // 英文敏感词
            'fuck', 'fuk', 'fuc', 'f*ck', 'f**k', 'fUCK', 'FUCK', 'fucker', 'fucking', 'fucked', 'fuckwit', 'fuckhead', 'fucktard', 'fucks', 'motherfucker', 'motherfucking', 'bullshit', 'bull shit', 'bullsh*t', 'shit', 'shithead', 'shitty', 'shits', 'shittier', 'shitting', 'shat', 'ass', 'asshole', 'asses', 'asshat', 'assbag', 'assbandit', 'assbanger', 'assclown', 'asscock', 'assface', 'asshat', 'asshead', 'asshopper', 'assjockey', 'asskisser', 'asslick', 'asslicker', 'assmonkey', 'assmunch', 'assmuncher', 'asswipe', 'asswipes', 'bastard', 'bastards', 'bastardized', 'bastardy', 'bitch', 'bitches', 'bitchy', 'bitching', 'bitched', 'bitcher', 'bitchers', 'bitchfest', 'bitchin', 'bitching', 'bitchtits', 'bitchy', 'bitchier', 'bitchiest', 'bitchslap', 'bitchslapping', 'bitoh', 'cock', 'cocks', 'cockface', 'cockhead', 'cockmunch', 'cockmuncher', 'cocksucker', 'cocksuckers', 'cocksucking', 'cocksucks', 'cocksukka', 'cocksucker', 'cockwaffle', 'cunt', 'cunts', 'cuntface', 'cuntfucker', 'cunting', 'cuntlick', 'cuntlicker', 'cuntlicking', 'cuntslut', 'damn', 'damned', 'damnit', 'dammit', 'dick', 'dicks', 'dickhead', 'dickheads', 'dickhole', 'dickholes', 'dickjuice', 'dickmilk', 'dickmonger', 'dicksucker', 'dicksucking', 'dicktickler', 'dickwad', 'dickweasel', 'dickweed', 'dickwod', 'dumb', 'dumbass', 'dumbasses', 'dumbbell', 'dumbhead', 'dumbshit', 'freak', 'freaking', 'freaks', 'gayer', 'gayest', 'gaygirl', 'gayguy', 'gayism', 'gaylords', 'gays', 'gaysex', 'goddamn', 'goddamned', 'goddammit', 'goddamn it', 'homo', 'homos', 'honkey', 'honkie', 'honky', 'jackass', 'jackasses', 'jap', 'japs', 'jigaboo', 'jiggaboo', 'jiggerboo', 'jizz', 'jizzed', 'jizzing', 'junkie', 'junkies', 'junky', 'kike', 'kikes', 'kunt', 'kunts', 'kuntweed', 'kwash', 'lameass', 'lame', 'lamer', 'lamest', 'lesbian', 'lesbians', 'lesbo', 'lesbos', 'loser', 'losers', 'louse', 'louses', 'lousier', 'lousiest', 'lousey', 'lousily', 'lousiness', 'lousy', 'lousiest', 'louse', 'masturbate', 'masturbating', 'masturbation', 'mofo', 'mofos', 'moolie', 'moolies', 'moran', 'morans', 'moron', 'morons', 'moronic', 'moronically', 'mothafucka', 'mothafuckas', 'mothafuckaz', 'mothafucked', 'mothafucker', 'mothafuckers', 'mothafuckin', 'mothafucking', 'mothafuckings', 'motherfucka', 'motherfuckas', 'motherfucked', 'motherfucker', 'motherfuckers', 'motherfuckin', 'motherfucking', 'motherfuckings', 'muthafucka', 'muthafuckas', 'muthafuckaz', 'muthafucked', 'muthafucker', 'muthafuckers', 'muthafuckin', 'muthafucking', 'muthafuckings', 'n1gger', 'n1gg3r', 'n1gg4', 'n4gger', 'nazi', 'nazis', 'negro', 'negroes', 'negress', 'negresses', 'nig', 'nigs', 'nigga', 'niggaz', 'nigger', 'niggerhead', 'niggerhole', 'niggers', 'niggle', 'niggles', 'niggling', 'niggor', 'nigguh', 'niggur', 'niglet', 'nignog', 'nip', 'nips', 'nookie', 'nookies', 'numbnuts', 'nutsack', 'orgasm', 'orgasms', 'orgy', 'orgies', 'paki', 'pakis', 'panooch', 'pecker', 'peckers', 'peckerwood', 'pecking', 'peckish', 'pedophile', 'pedophiles', 'pedophilia', 'pedophiliac', 'penis', 'penises', 'piss', 'pissed', 'pisser', 'pissers', 'pisses', 'pissing', 'pissoff', 'piss-off', 'pms', 'pollock', 'pollocks', 'poon', 'poontang', 'poop', 'pooped', 'pooping', 'poops', 'poopy', 'prick', 'pricks', 'prickhead', 'pricking', 'pricksucker', 'pussies', 'pussy', 'pussyfucker', 'pussying', 'queer', 'queers', 'queerdo', 'queerods', 'renob', 'retard', 'retarded', 'retardation', 'retards', 'sadist', 'sadists', 'scag', 'scags', 'scat', 'schlong', 'schlongs', 'screw', 'screwed', 'screwing', 'screws', 'scum', 'scumbag', 'scumbags', 'semen', 'sex', 'sexual', 'sexually', 'shag', 'shagged', 'shagging', 'shags', 'shat', 'shit', 'shitass', 'shitbag', 'shitbags', 'shitbird', 'shitbitch', 'shitbrain', 'shitbrains', 'shitbrick', 'shitbricks', 'shitcunt', 'shitdick', 'shitface', 'shitfaced', 'shithead', 'shitheads', 'shithole', 'shitholes', 'shithouse', 'shiting', 'shitlist', 'shitlists', 'shitload', 'shitloads', 'shitman', 'shitpack', 'shitpans', 'shitraper', 'shits', 'shitshow', 'shitshows', 'shitstain', 'shitstains', 'shitted', 'shitter', 'shitters', 'shitting', 'shitty', 'shiz', 'shiznit', 'skag', 'skags', 'skank', 'skanks', 'skanktard', 'skeet', 'slant', 'slants', 'slanteye', 'slit', 'slits', 'slut', 'sluts', 'slutbag', 'slutbags', 'slutty', 'slutting', 'slutwear', 'slutwork', 'smeg', 'smegma', 'smegmatic', 'snatch', 'snatches', 'sodom', 'sodomize', 'sodomized', 'sodomizes', 'sodomizing', 'sodomy', 'sonofabitch', 'sonofbitch', 'spic', 'spics', 'spik', 'spiks', 'spook', 'spooks', 'stupid', 'stupider', 'stupidest', 'stupidities', 'stupidity', 'suck', 'sucks', 'sucking', 'sucksed', 'sucky', 'suicide', 'suicides', 'tard', 'tards', 'testicle', 'testicles', 'thundercunt', 'tit', 'tits', 'titfuck', 'titfucker', 'titfucks', 'titi', 'tits', 'titty', 'tittyfuck', 'tittyfucker', 'tittyfucks', 'titwank', 'towelhead', 'towelheads', 'tranny', 'trannies', 'transgender', 'transsexuals', 'tubgirl', 'tubgirls', 'turd', 'turds', 'tush', 'tushy', 'twat', 'twats', 'twatwaffle', 'ugly', 'uglies', 'ugliest', 'uglyness', 'unclefucker', 'unclefuckers', 'vagina', 'vaginas', 'vajayjay', 'vajaja', 'vajayjay', 'valve', 'valves', 'wank', 'wanked', 'wanker', 'wankers', 'wanking', 'wanks', 'wankstain', 'wankweed', 'wetback', 'wetbacks', 'whore', 'whores', 'whoreface', 'whorefucker', 'whores', 'whorey', 'wigger', 'wiggers', 'wombat', 'wombats', 'wop', 'wops'];
        const stored = localStorage.getItem('snake-badwords');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                return defaultBadWords;
            }
        }
        return defaultBadWords;
    }

    // 从Firebase加载敏感词
    async loadBadWordsFromFirebase() {
        if (typeof firebase === 'undefined') return;
        try {
            const snapshot = await firebase.database().ref('badwords').once('value');
            const badwords = snapshot.val();
            if (badwords && Array.isArray(badwords) && badwords.length > 0) {
                localStorage.setItem('snake-badwords', JSON.stringify(badwords));
                console.log('从Firebase加载了敏感词:', badwords.length, '个');
            }
        } catch (e) {
            console.log('从Firebase加载敏感词失败:', e.message);
        }
    }

    // 保存敏感词列表（同时保存到Firebase）
    saveBadWords(badWords) {
        localStorage.setItem('snake-badwords', JSON.stringify(badWords));

        // 同时保存到Firebase
        if (typeof firebase !== 'undefined') {
            firebase.database().ref('badwords').set(badWords).then(() => {
                console.log('敏感词已保存到Firebase');
            }).catch(e => {
                console.log('保存敏感词到Firebase失败:', e.message);
            });
        }
    }

    // 检查是否包含敏感词
    checkBadWords(playerName) {
        if (!playerName || playerName.trim() === '') return false;
        const name = playerName.trim().toLowerCase();
        const badWords = this.getBadWords();
        for (const word of badWords) {
            if (name.includes(word.toLowerCase())) {
                return true; // 包含敏感词
            }
        }
        return false; // 不包含敏感词
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
        });

        document.getElementById('show-login').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-form').style.display = 'none';
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

        // 管理员登录页的忘记密码
        document.getElementById('show-forgot-from-admin')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('admin-form').style.display = 'none';
            document.getElementById('forgot-form').style.display = 'block';
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

        // 忘记密码 - 第一步：发送验证码
        document.getElementById('forgot-btn').addEventListener('click', async () => {
            const username = document.getElementById('forgot-username').value.trim();
            const email = document.getElementById('forgot-email').value.trim();

            const user = this.users[username];
            console.log('查找用户:', username);
            console.log('用户数据:', user);
            console.log('输入邮箱:', email);

            if (!user) {
                document.getElementById('auth-error').textContent = '用户不存在';
                return;
            }

            // 所有用户都需要验证邮箱
            let storedEmail = (user.email || '').trim().toLowerCase();
            const inputEmail = email.trim().toLowerCase();
            console.log('storedEmail:', storedEmail);
            console.log('inputEmail:', inputEmail);

            // 特殊处理：如果用户输入的是正确邮箱，直接通过
            if (username === 'admin' && inputEmail === 'acientemple@gmail.com') {
                console.log('admin 邮箱验证通过');
            } else if (inputEmail !== storedEmail) {
                console.log('邮箱不匹配');
                document.getElementById('auth-error').textContent = '用户名与邮箱不匹配，请检查';
                return;
            }

            // 生成验证码
            const resetCode = Math.random().toString(36).substring(2, 10).toUpperCase();
            localStorage.setItem('snake-reset-code', resetCode);
            localStorage.setItem('snake-reset-user', username);

            // 发送验证码邮件
            document.getElementById('auth-error').textContent = '正在发送邮件...';

            console.log('准备发送邮件 - 邮箱:', email, '用户名:', username, '验证码:', resetCode);
            const emailSent = await this.sendPasswordResetEmail(email, username, resetCode);

            if (!emailSent) {
                // 发送失败，停留在当前步骤
                document.getElementById('auth-error').textContent = '邮件发送失败，请重试';
                return;
            }

            // 发送成功，进入下一步
            document.getElementById('forgot-step1').style.display = 'none';
            document.getElementById('forgot-step2').style.display = 'block';
            document.getElementById('auth-error').textContent = '';
        });

        // 忘记密码 - 第二步：验证验证码
        document.getElementById('use-link-btn').addEventListener('click', () => {
            const inputCode = document.getElementById('reset-code-input').value.trim();
            const storedCode = localStorage.getItem('snake-reset-code');

            if (!inputCode) {
                alert('请输入收到的验证码');
                return;
            }

            if (inputCode !== storedCode) {
                alert('验证码错误，请重试');
                return;
            }

            // 验证成功，进入第三步
            document.getElementById('forgot-step2').style.display = 'none';
            document.getElementById('forgot-step3').style.display = 'block';
        });

        // 忘记密码 - 第三步：确认重置（使用 Firebase）
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

            // 重置密码到 Firebase
            firebase.database().ref('users/' + resetUser + '/password').set(simpleHash(newPassword))
                .then(() => {
                    console.log('Firebase 密码重置成功');

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
                })
                .catch((error) => {
                    alert('密码重置失败: ' + error.message);
                });
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

        // 管理员登录 - 使用 Firebase
        // 支持回车键登录
        document.getElementById('admin-username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
        });
        document.getElementById('admin-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
        });

        document.getElementById('admin-login-btn').addEventListener('click', () => {
            const username = document.getElementById('admin-username').value.trim();
            const password = document.getElementById('admin-password').value;

            if (!username || !password) {
                document.getElementById('auth-error').textContent = '请输入用户名和密码';
                return;
            }

            document.getElementById('auth-error').textContent = '登录中...';

            // 从 Firebase 验证管理员账号
            firebase.database().ref('users').once('value', (snapshot) => {
                const users = snapshot.val() || {};
                const user = users[username];

                if (!user) {
                    document.getElementById('auth-error').textContent = '管理员账号不存在';
                    return;
                }

                if (user.password !== simpleHash(password)) {
                    document.getElementById('auth-error').textContent = '密码错误';
                    return;
                }

                // 检查是否是管理员
                const isAdmin = user.isAdmin || (user.data && user.data.isAdmin);
                if (!isAdmin) {
                    document.getElementById('auth-error').textContent = '您不是管理员';
                    return;
                }

                // 登录成功 - 从 Firebase 同步所有数据
                console.log('Firebase 管理员登录成功:', username);
                this.currentUser = username;
                this.isAdmin = true;
                localStorage.setItem('snake-current-user', username);
                localStorage.setItem('snake-admin', 'true');
                document.getElementById('auth-error').textContent = '正在同步数据...';

                // 从 Firebase 读取用户数据
                this.users = users;
                localStorage.setItem('snake-users', JSON.stringify(users));

                // 读取游戏记录
                firebase.database().ref('records').once('value', (recSnapshot) => {
                    const records = recSnapshot.val() || [];
                    localStorage.setItem('snake-records', JSON.stringify(records));
                    console.log('从Firebase加载了 ' + records.length + ' 条记录');

                    // 读取最高记录
                    firebase.database().ref('topRecords').once('value', (topSnapshot) => {
                        const topRecords = topSnapshot.val() || {};
                        localStorage.setItem('snake-top-records', JSON.stringify(Object.values(topRecords)));
                        console.log('从Firebase加载了 ' + Object.values(topRecords).length + ' 条最高记录');

                        // 读取成就
                        firebase.database().ref('achievements/' + username).once('value', (achSnapshot) => {
                            const achievements = achSnapshot.val();
                            if (achievements) {
                                localStorage.setItem('snake-achievements-' + username, JSON.stringify(achievements));
                                console.log('从Firebase加载了成就');
                            }

                            document.getElementById('auth-error').textContent = '';
                            this.showGame();
                        });
                    });
                });
            }, (error) => {
                document.getElementById('auth-error').textContent = '登录失败: ' + error.message;
            });
        });

        // 登录 - 使用 Firebase
        // 支持回车键登录
        document.getElementById('login-username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('login-btn').click();
        });
        document.getElementById('login-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('login-btn').click();
        });

        // 加载保存的用户名和密码
        const savedUsername = localStorage.getItem('snake-remember-username');
        const savedPassword = localStorage.getItem('snake-remember-password');
        const rememberMe = localStorage.getItem('snake-remember-me');
        if (savedUsername) {
            document.getElementById('login-username').value = savedUsername;
        }
        if (savedPassword && rememberMe === 'true') {
            document.getElementById('login-password').value = savedPassword;
            document.getElementById('remember-me').checked = true;
        }

        // 清除保存的用户名和密码
        document.getElementById('clear-credentials').addEventListener('click', () => {
            localStorage.removeItem('snake-remember-username');
            localStorage.removeItem('snake-remember-password');
            localStorage.removeItem('snake-remember-me');
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
            document.getElementById('remember-me').checked = false;
            document.getElementById('auth-error').textContent = '已清除保存的凭证';
            document.getElementById('auth-error').style.color = 'green';
        });

        document.getElementById('login-btn').addEventListener('click', () => {
            console.log('登录按钮点击 (Firebase)');

            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;
            const rememberChecked = document.getElementById('remember-me').checked;

            if (!username) {
                document.getElementById('auth-error').textContent = '请输入用户名';
                return;
            }
            if (!password) {
                document.getElementById('auth-error').textContent = '请输入密码';
                return;
            }

            // 保存用户名和密码（如果记住我被勾选）
            localStorage.setItem('snake-remember-username', username);
            if (rememberChecked) {
                localStorage.setItem('snake-remember-password', password);
                localStorage.setItem('snake-remember-me', 'true');
            } else {
                localStorage.removeItem('snake-remember-password');
                localStorage.setItem('snake-remember-me', 'false');
            }

            document.getElementById('auth-error').textContent = '登录中...';

            // 从 Firebase 验证用户
            firebase.database().ref('users').once('value', (snapshot) => {
                const users = snapshot.val() || {};
                const user = users[username];

                if (!user || user.password !== simpleHash(password)) {
                    document.getElementById('auth-error').textContent = '用户名或密码错误';
                    return;
                }

                // 登录成功 - 先清空本地数据
                console.log('Firebase 登录成功:', username);
                this.currentUser = username;
                this.isAdmin = user.isAdmin || false;
                localStorage.setItem('snake-current-user', username);
                localStorage.setItem('snake-admin', this.isAdmin ? 'true' : 'false');
                document.getElementById('auth-error').textContent = '正在同步数据...';

                // 清空本地旧数据，从 Firebase 读取最新数据
                this.users = users;
                localStorage.setItem('snake-users', JSON.stringify(users));

                // 读取游戏记录
                firebase.database().ref('records').once('value', (recSnapshot) => {
                    const records = recSnapshot.val() || [];
                    localStorage.setItem('snake-records', JSON.stringify(records));
                    console.log('从Firebase加载了 ' + records.length + ' 条记录');

                    // 读取最高记录
                    firebase.database().ref('topRecords').once('value', (topSnapshot) => {
                        const topRecords = topSnapshot.val() || {};
                        localStorage.setItem('snake-top-records', JSON.stringify(Object.values(topRecords)));
                        console.log('从Firebase加载了 ' + Object.values(topRecords).length + ' 条最高记录');

                        // 读取成就
                        firebase.database().ref('achievements/' + username).once('value', (achSnapshot) => {
                            const achievements = achSnapshot.val();
                            if (achievements) {
                                localStorage.setItem('snake-achievements-' + username, JSON.stringify(achievements));
                                console.log('从Firebase加载了成就');
                            }

                            document.getElementById('auth-error').textContent = '';
                            this.showGame();
                        });
                    });
                });
            }, (error) => {
                document.getElementById('auth-error').textContent = '登录失败: ' + error.message;
            });
        });

        // 游客直接进入游戏
        document.getElementById('guest-btn').addEventListener('click', () => {
            console.log('游客进入游戏');
            // 隐藏登录面板
            document.getElementById('auth-panel').style.display = 'none';
            // 显示游戏容器
            document.getElementById('game-container').style.display = 'block';
            // 设置为游客模式
            this.currentUser = '游客';
            this.isAdmin = false;
            localStorage.setItem('snake-current-user', '游客');
            localStorage.setItem('snake-admin', 'false');
            // 确保 auth.currentUser 也设置为游客（用于 saveRecord 判断）
            if (window.auth) {
                window.auth.currentUser = '游客';
            }
            this.currentUser = '游客';
            // 清空之前的游客记录（每次新游客会话）
            localStorage.removeItem('snake-guest-records');
            // 初始化游戏
            initGame();

            // 加载全部玩家记录（游客也需要显示排行榜）
            if (typeof firebase !== 'undefined') {
                firebase.database().ref('records').once('value', (snapshot) => {
                    const records = snapshot.val() || [];
                    localStorage.setItem('snake-records', JSON.stringify(records));
                    console.log('游客模式加载了 ' + records.length + ' 条记录');
                    if (game) game.displayRecords();
                });
            }

            console.log('游客模式已启动');
        });

        // 注册 - 使用 Firebase
        // 支持回车键注册

        // 注册用户名实时检测敏感词
        const regUsernameInput = document.getElementById('reg-username');
        if (regUsernameInput) {
            regUsernameInput.addEventListener('input', () => {
                const inputName = regUsernameInput.value.trim();
                if (inputName && window.auth && window.auth.checkBadWords && window.auth.checkBadWords(inputName)) {
                    regUsernameInput.setCustomValidity('用户名包含敏感词');
                } else {
                    regUsernameInput.setCustomValidity('');
                }
            });
        }

        document.getElementById('reg-username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('register-btn').click();
        });
        document.getElementById('reg-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('register-btn').click();
        });
        document.getElementById('reg-password2').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('register-btn').click();
        });

        document.getElementById('register-btn').addEventListener('click', () => {
            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const password2 = document.getElementById('reg-password2').value;

            if (!username) {
                document.getElementById('auth-error').textContent = '请输入用户名';
                return;
            }

            // 检查敏感词
            if (window.auth && window.auth.checkBadWords && window.auth.checkBadWords(username)) {
                document.getElementById('auth-error').textContent = '用户名包含敏感词，请重新输入';
                return;
            }

            if (!password || password.length < 3) {
                document.getElementById('auth-error').textContent = '密码至少3位';
                return;
            }
            if (password !== password2) {
                document.getElementById('auth-error').textContent = '两次密码不一致';
                return;
            }

            document.getElementById('auth-error').textContent = '注册中...';

            // 检查用户名是否已存在于 Firebase
            firebase.database().ref('users').once('value', (snapshot) => {
                const users = snapshot.val() || {};

                if (users[username]) {
                    document.getElementById('auth-error').textContent = '用户名已存在，请更换';
                    return;
                }

                // 注册到 Firebase
                const hashedPassword = simpleHash(password);
                firebase.database().ref('users/' + username).set({
                    password: hashedPassword,
                    email: email || '',
                    createdAt: Date.now()
                }).then(() => {
                    console.log('Firebase 注册成功:', username);
                    this.currentUser = username;
                    localStorage.setItem('snake-current-user', username);
                    document.getElementById('auth-error').textContent = '正在同步数据...';

                    // 读取所有用户数据
                    firebase.database().ref('users').once('value', (usersSnapshot) => {
                        const users = usersSnapshot.val() || {};
                        localStorage.setItem('snake-users', JSON.stringify(users));

                        // 读取游戏记录
                        firebase.database().ref('records').once('value', (recSnapshot) => {
                            const records = recSnapshot.val() || [];
                            localStorage.setItem('snake-records', JSON.stringify(records));

                            // 读取最高记录
                            firebase.database().ref('topRecords').once('value', (topSnapshot) => {
                                const topRecords = topSnapshot.val() || {};
                                localStorage.setItem('snake-top-records', JSON.stringify(Object.values(topRecords)));

                                // 读取成就
                                firebase.database().ref('achievements/' + username).once('value', (achSnapshot) => {
                                    const achievements = achSnapshot.val();
                                    if (achievements) {
                                        localStorage.setItem('snake-achievements-' + username, JSON.stringify(achievements));
                                    }

                                    // 显示成功并跳转到游戏
                                    document.getElementById('auth-error').style.color = 'green';
                                    document.getElementById('auth-error').textContent = '注册成功！正在进入游戏...';

                                    setTimeout(() => {
                                        this.showGame();
                                    }, 500);
                                });
                            });
                        });
                    });
                }).catch((error) => {
                    document.getElementById('auth-error').style.color = 'red';
                    document.getElementById('auth-error').textContent = '注册失败: ' + error.message;
                });
            }, (error) => {
                document.getElementById('auth-error').textContent = '检查用户失败: ' + error.message;
            });
        });

        // GitHub 同步（仅admin页面）
        const syncBtn = document.getElementById('sync-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => {
                this.syncToGitHub();
            });
        }

        // GitHub 下载（仅admin页面）
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadFromGitHub();
            });
        }

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

        // 移除已存在的用户信息（防止重复添加）
        const existingUserInfo = document.querySelector('.user-info');
        if (existingUserInfo) {
            existingUserInfo.remove();
        }

        // 显示用户信息
        const header = document.querySelector('.game-header');
        if (header) {
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
            const changePassBtn = document.getElementById('change-pass-btn');
            if (changePassBtn) {
                changePassBtn.addEventListener('click', () => {
                    if (window.auth) {
                        window.auth.showChangePasswordDialog();
                    }
                });
            }

            // 退出按钮
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    this.logout();
                    location.reload();
                });
            }
        }

        // 开发者模式下显示管理面板按钮
        if (this.isAdmin) {
            this.showAdminPanel();
        }

        // 登录后自动从 GitHub 加载最新数据
        this.loadFromGitHubOnLogin();

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
                    <h3>📧 EmailJS 邮件配置</h3>
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
                        <li>创建 Email Template，<strong>关键步骤</strong>：<br>
                            - 点击模板编辑页面右上角的 <strong>"Settings"</strong><br>
                            - 在 <strong>"To Email"</strong> 字段中输入 <code>{{to_email}}</code><br>
                            - 保存模板<br>
                            - 模板正文使用: <code>{{to_name}}</code>, <code>{{reset_code}}</code></li>
                        <li>获取 Public Key（在 Account → API Keys）</li>
                        <li>获取 Service ID（Email Services 中）</li>
                        <li>获取 Template ID（Email Templates 中）</li>
                    </ol>
                    <p style="font-size:12px;color:#e74c3c;background:#fdf0ef;padding:10px;border-radius:5px;">
                        <strong>如果遇到 "insufficient authentication biases" 错误：</strong><br>
                        必须删除旧的 Gmail 服务，重新连接并授予 <strong>"Send email on your behalf"</strong> 权限
                    </p>
                    <div id="email-config-status" style="margin-top:10px;font-size:12px;"></div>
                    <div style="margin-top:10px;">
                        <button id="test-email-btn" class="auth-btn" style="padding:8px 15px;width:auto;margin:0;background:#3498db;">发送测试邮件</button>
                        <input type="text" id="test-email-address" placeholder="测试收件人邮箱" style="padding:8px;width:180px;margin:5px 0;">
                    </div>
                </div>
                <div class="admin-section">
                    <h3>🚫 敏感词管理</h3>
                    <div style="display:flex;gap:10px;margin-bottom:10px;">
                        <input type="text" id="badword-input" placeholder="输入新敏感词" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:5px;">
                        <button id="add-badword-btn" class="auth-btn" style="padding:8px 15px;width:auto;margin:0;">添加</button>
                    </div>
                    <div id="badword-list" style="max-height:150px;overflow-y:auto;background:white;border:1px solid #ddd;border-radius:5px;padding:10px;margin-bottom:10px;"></div>
                    <button id="reset-badwords-btn" class="auth-btn" style="background:#e74c3c;padding:8px 15px;width:auto;margin:0;">重置为默认</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        this.loadEmailConfig();

        // 测试邮件发送
        document.getElementById('test-email-btn').addEventListener('click', async () => {
            const testEmail = document.getElementById('test-email-address').value.trim();
            if (!testEmail) {
                alert('请输入测试收件人邮箱');
                return;
            }

            const testCode = 'TEST123';
            document.getElementById('email-config-status').innerHTML = '<span style="color:#3498db;">正在发送测试邮件...</span>';

            const success = await this.sendPasswordResetEmail(testEmail, '测试用户', testCode);

            if (success) {
                document.getElementById('email-config-status').innerHTML = '<span style="color:green;">✓ 测试邮件发送成功！</span>';
            } else {
                document.getElementById('email-config-status').innerHTML = '<span style="color:red;">✗ 测试邮件发送失败，请检查配置</span>';
            }
        });
        this.loadAdminData();

        // 敏感词管理功能
        const defaultBadWords = ['傻逼', '傻B', 'SB', '傻b', '傻B', '操', '麻痹', '妈逼', '滚蛋', '去死', '废物', '蠢货', '阳痿', '早泄', '婊子', '妓女', '贱人', '贱货', '狗屎', '垃圾', '笨蛋', '白痴', '智障', '丑八怪', '长得丑', '丑逼', '臭不要脸', '不要脸', '神经病', '精神病', '疯子', '变态', '人渣', '王八', '乌龟', '王八蛋', '龟儿子', '杂种', '野种', '死全家', '全家死光', '断子绝孙', '不得好死', '天打雷劈', '遭雷劈', '下地狱', '畜生', '禽兽', '恶心', '丑陋', '难看', '恶心吧啦', '恶臭', '臭虫', '蛀虫', '寄生虫', '吸血鬼', '败类', '恶棍', '恶霸', '土匪', '强盗', '骗子', '无赖', '痞子', '地痞', '流氓', '痞子', '无赖', '赖皮', '不要脸', '厚颜无耻', '恬不知耻', '臭名昭著', '臭名远扬', '遗臭万年', '臭烘烘', '脏东西', '污秽', '污浊', '腐烂', '腐臭', '腐朽', '腐败', '腐化', '腐蚀', '侵蚀', '腐朽', '腐肉', '腐尸',
            'fuck', 'fuk', 'fuc', 'f*ck', 'f**k', 'fUCK', 'FUCK', 'fucker', 'fucking', 'fucked', 'fuckwit', 'fuckhead', 'fucktard', 'fucks', 'motherfucker', 'motherfucking', 'bullshit', 'bull shit', 'bullsh*t', 'shit', 'shithead', 'shitty', 'shits', 'shittier', 'shitting', 'shat', 'ass', 'asshole', 'asses', 'asshat', 'assbag', 'assbandit', 'assbanger', 'assclown', 'asscock', 'assface', 'asshead', 'asshopper', 'assjockey', 'asskisser', 'asslick', 'asslicker', 'assmonkey', 'assmunch', 'assmuncher', 'asswipe', 'asswipes', 'bastard', 'bastards', 'bastardized', 'bastardy', 'bitch', 'bitches', 'bitchy', 'bitching', 'bitched', 'bitcher', 'bitchers', 'bitchfest', 'bitchin', 'bitching', 'bitchtits', 'bitchy', 'bitchier', 'bitchiest', 'bitoh', 'cock', 'cocks', 'cockface', 'cockhead', 'cockmunch', 'cockmuncher', 'cocksucker', 'cocksuckers', 'cocksucking', 'cocksucks', 'cocksukka', 'cockwaffle', 'cunt', 'cunts', 'cuntface', 'cuntfucker', 'cunting', 'cuntlick', 'cuntlicker', 'cuntlicking', 'cuntslut', 'damn', 'damned', 'damnit', 'dammit', 'dick', 'dicks', 'dickhead', 'dickheads', 'dickhole', 'dickholes', 'dickjuice', 'dickmilk', 'dickmonger', 'dicksucker', 'dicksucking', 'dicktickler', 'dickwad', 'dickweasel', 'dickweed', 'dickwod', 'dumb', 'dumbass', 'dumbasses', 'dumbbell', 'dumbhead', 'dumbshit', 'freak', 'freaking', 'freaks', 'gayer', 'gayest', 'gaygirl', 'gayguy', 'gayism', 'gaylords', 'gays', 'gaysex', 'goddamn', 'goddamned', 'goddammit', 'goddamn it', 'homo', 'homos', 'honkey', 'honkie', 'honky', 'jackass', 'jackasses', 'jap', 'japs', 'jigaboo', 'jiggaboo', 'jiggerboo', 'jizz', 'jizzed', 'jizzing', 'junkie', 'junkies', 'junky', 'kike', 'kikes', 'kunt', 'kunts', 'kuntweed', 'kwash', 'lameass', 'lame', 'lamer', 'lamest', 'lesbian', 'lesbians', 'lesbo', 'lesbos', 'loser', 'losers', 'louse', 'louses', 'lousier', 'lousiest', 'lousey', 'lousily', 'lousiness', 'lousy', 'lousiest', 'louse', 'masturbate', 'masturbating', 'masturbation', 'mofo', 'mofos', 'moolie', 'moolies', 'moran', 'morans', 'moron', 'morons', 'moronic', 'moronically', 'mothafucka', 'mothafuckas', 'mothafuckaz', 'mothafucked', 'mothafucker', 'mothafuckers', 'mothafuckin', 'mothafucking', 'mothafuckings', 'motherfucka', 'motherfuckas', 'motherfucked', 'motherfucker', 'motherfuckers', 'motherfuckin', 'motherfucking', 'motherfuckings', 'muthafucka', 'muthafuckas', 'muthafuckaz', 'muthafucked', 'muthafucker', 'muthafuckers', 'muthafuckin', 'muthafucking', 'muthafuckings', 'n1gger', 'n1gg3r', 'n1gg4', 'n4gger', 'nazi', 'nazis', 'negro', 'negroes', 'negress', 'negresses', 'nig', 'nigs', 'nigga', 'niggaz', 'nigger', 'niggerhead', 'niggerhole', 'niggers', 'niggle', 'niggles', 'niggling', 'niggor', 'nigguh', 'niggur', 'niglet', 'nignog', 'nip', 'nips', 'nookie', 'nookies', 'numbnuts', 'nutsack', 'orgasm', 'orgasms', 'orgy', 'orgies', 'paki', 'pakis', 'panooch', 'pecker', 'peckers', 'peckerwood', 'pecking', 'peckish', 'pedophile', 'pedophiles', 'pedophilia', 'pedophiliac', 'penis', 'penises', 'piss', 'pissed', 'pisser', 'pissers', 'pisses', 'pissing', 'pissoff', 'piss-off', 'pms', 'pollock', 'pollocks', 'poon', 'poontang', 'poop', 'pooped', 'pooping', 'poops', 'poopy', 'prick', 'pricks', 'prickhead', 'pricking', 'pricksucker', 'pussies', 'pussy', 'pussyfucker', 'pussying', 'queer', 'queers', 'queerdo', 'queerods', 'renob', 'retard', 'retarded', 'retardation', 'retards', 'sadist', 'sadists', 'scag', 'scags', 'scat', 'schlong', 'schlongs', 'screw', 'screwed', 'screwing', 'screws', 'scum', 'scumbag', 'scumbags', 'semen', 'sex', 'sexual', 'sexually', 'shag', 'shagged', 'shagging', 'shags', 'shat', 'shit', 'shitass', 'shitbag', 'shitbags', 'shitbird', 'shitbitch', 'shitbrain', 'shitbrains', 'shitbrick', 'shitbricks', 'shitcunt', 'shitdick', 'shitface', 'shitfaced', 'shithead', 'shitheads', 'shithole', 'shitholes', 'shithouse', 'shiting', 'shitlist', 'shitlists', 'shitload', 'shitloads', 'shitman', 'shitpack', 'shitpans', 'shitraper', 'shits', 'shitshow', 'shitshows', 'shitstain', 'shitstains', 'shitted', 'shitter', 'shitters', 'shitting', 'shitty', 'shiz', 'shiznit', 'skag', 'skags', 'skank', 'skanks', 'skanktard', 'skeet', 'slant', 'slants', 'slanteye', 'slit', 'slits', 'slut', 'sluts', 'slutbag', 'slutbags', 'slutty', 'slutting', 'slutwear', 'slutwork', 'smeg', 'smegma', 'smegmatic', 'snatch', 'snatches', 'sodom', 'sodomize', 'sodomized', 'sodomizes', 'sodomizing', 'sodomy', 'sonofabitch', 'sonofbitch', 'spic', 'spics', 'spik', 'spiks', 'spook', 'spooks', 'stupid', 'stupider', 'stupidest', 'stupidities', 'stupidity', 'suck', 'sucks', 'sucking', 'sucksed', 'sucky', 'suicide', 'suicides', 'tard', 'tards', 'testicle', 'testicles', 'thundercunt', 'tit', 'tits', 'titfuck', 'titfucker', 'titfucks', 'titi', 'tits', 'titty', 'tittyfuck', 'tittyfucker', 'tittyfucks', 'titwank', 'towelhead', 'towelheads', 'tranny', 'trannies', 'transgender', 'transsexuals', 'tubgirl', 'tubgirls', 'turd', 'turds', 'tush', 'tushy', 'twat', 'twats', 'twatwaffle', 'ugly', 'uglies', 'ugliest', 'uglyness', 'unclefucker', 'unclefuckers', 'vagina', 'vaginas', 'vajayjay', 'vajaja', 'vajayjay', 'valve', 'valves', 'wank', 'wanked', 'wanker', 'wankers', 'wanking', 'wanks', 'wankstain', 'wankweed', 'wetback', 'wetbacks', 'whore', 'whores', 'whoreface', 'whorefucker', 'whores', 'whorey', 'wigger', 'wiggers', 'wombat', 'wombats', 'wop', 'wops'];

        function getBadWords() {
            const stored = localStorage.getItem('snake-badwords');
            if (stored) {
                try { return JSON.parse(stored); } catch (e) { return [...defaultBadWords]; }
            }
            return [...defaultBadWords];
        }

        function saveBadWords(badWords) {
            localStorage.setItem('snake-badwords', JSON.stringify(badWords));
        }

        function loadBadWords() {
            const badWords = getBadWords();
            const listEl = document.getElementById('badword-list');
            listEl.innerHTML = '';
            if (badWords.length === 0) {
                listEl.innerHTML = '<p style="color:#666;">暂无敏感词</p>';
                return;
            }
            badWords.forEach((word, index) => {
                const div = document.createElement('div');
                div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px;border-bottom:1px solid #eee;';
                div.innerHTML = `<span>${word}</span><button onclick="deleteBadWord(${index})" style="background:#e74c3c;color:white;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:12px;">删除</button>`;
                listEl.appendChild(div);
            });
        }

        window.deleteBadWord = function(index) {
            const badWords = getBadWords();
            if (!confirm('确定要删除敏感词 "' + badWords[index] + '" 吗？')) return;
            badWords.splice(index, 1);
            saveBadWords(badWords);
            loadBadWords();
            alert('敏感词已删除');
        };

        // 添加敏感词
        document.getElementById('add-badword-btn').addEventListener('click', function() {
            const input = document.getElementById('badword-input');
            const newWord = input.value.trim();
            if (!newWord) { alert('请输入敏感词'); return; }
            const badWords = getBadWords();
            if (badWords.includes(newWord)) { alert('敏感词已存在'); return; }
            badWords.push(newWord);
            saveBadWords(badWords);
            input.value = '';
            loadBadWords();
            alert('敏感词已添加');
        });

        // 重置为默认
        document.getElementById('reset-badwords-btn').addEventListener('click', function() {
            if (!confirm('确定要重置敏感词为默认列表吗？')) return;
            saveBadWords([...defaultBadWords]);
            loadBadWords();
            alert('敏感词已重置为默认');
        });

        loadBadWords();

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
            console.log('=== 保存 EmailJS 配置 ===');
            console.log('保存的 config:', config);
            localStorage.setItem('snake-emailjs-config', JSON.stringify(config));
            console.log('localStorage 保存后的值:', localStorage.getItem('snake-emailjs-config'));

            // 更新内存中的配置
            EMAILJS_CONFIG.publicKey = publicKey;
            EMAILJS_CONFIG.serviceId = serviceId;
            EMAILJS_CONFIG.templateId = templateId;

            // 初始化 EmailJS
            if (typeof emailjs !== 'undefined') {
                emailjs.init(publicKey);
            }

            document.getElementById('email-config-status').innerHTML = '<span style="color:green;">✓ 配置已保存，邮件功能已启用</span>';
            alert('配置已保存！Public Key: ' + publicKey);
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

        // 显示用户列表（带删除和管理员功能）
        const userList = document.getElementById('user-list');
        if (users.length === 0) {
            userList.innerHTML = '<p>暂无注册用户</p>';
        } else {
            let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><tr style="background:#f5f5f5;"><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">用户名</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">邮箱</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">注册时间</th><th style="text-align:center;padding:8px;border-bottom:1px solid #ddd;">操作</th></tr>';
            users.forEach(u => {
                const user = this.users[u];
                const isAdminUser = user.isAdmin || (user.data && user.data.isAdmin);
                let buttons = '';
                if (!isAdminUser) {
                    buttons += `<button onclick="window.auth.adminSetAdmin('${u}'); window.game.loadAdminData();" style="background:#3498db;color:white;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;">设为管理</button>`;
                } else if (u !== 'admin') {
                    buttons += `<button onclick="window.auth.adminRemoveAdmin('${u}'); window.game.loadAdminData();" style="background:#f39c12;color:white;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;">取消管理</button>`;
                }
                if (u !== 'admin') {
                    buttons += `<button onclick="window.auth.adminDeleteUser('${u}'); window.game.loadAdminData();" style="background:#e74c3c;color:white;border:none;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:12px;">删除</button>`;
                } else {
                    buttons += `<span style="color:red;font-size:12px;">[管理员]</span>`;
                }
                html += `<tr>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${u}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${user.email || '-'}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;">${user.created ? user.created.substring(0,10) : '-'}</td>
                    <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">
                        ${buttons}
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
    window.game = game; // 供虚拟控制键使用

    game.displayRecords('mine');
    game.updatePlayerNamesDropdown();
    game.handleModeChange(document.getElementById('game-mode').value);
    game.updateModeUI(document.getElementById('game-mode').value);
    game.initRecordTabs();

    // 初始化速度显示
    const speed = parseInt(document.getElementById('game-speed').value);
    document.getElementById('speed-value').textContent = game.getSpeedLabel(speed);
    document.getElementById('current-speed').textContent = speed;

    // 初始化设备检测和虚拟控制键
    initDeviceDetection();

    game.draw();
}

// 设备检测和虚拟控制键
function initDeviceDetection() {
    // 检测是否为触摸屏设备
    const isTouchDevice = ('ontouchstart' in window) ||
                          (navigator.maxTouchPoints > 0) ||
                          (navigator.msMaxTouchPoints > 0);

    // 检测是否为 iPad
    const isIPad = /iPad/i.test(navigator.userAgent) ||
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    console.log(`设备检测: iPad=${isIPad}, maxTouchPoints=${navigator.maxTouchPoints}, userAgent=${navigator.userAgent}`);

    // 检测设备类型 - 平板或手机都显示虚拟控制键
    const screenWidth = window.innerWidth;
    const isSmallScreen = screenWidth < 1100; // 屏幕宽度小于1100px认为是移动/平板设备

    // iPad 或满足触摸和小屏幕条件时显示虚拟控制键
    const showVirtualControls = isTouchDevice && (isSmallScreen || isIPad);

    console.log(`屏幕宽度: ${screenWidth}, 触摸: ${isTouchDevice}, iPad: ${isIPad}, 显示虚拟控制键: ${showVirtualControls}`);

    if (showVirtualControls) {
        const vc = document.getElementById('virtual-controls');
        if (vc) {
            vc.classList.add('show');
        }

        // 显示提示（非全屏模式），30秒后自动隐藏
        const vcTip = document.getElementById('vc-tip');
        if (vcTip) {
            vcTip.style.display = 'block';
            // 30秒后自动隐藏提示
            setTimeout(() => {
                vcTip.style.display = 'none';
            }, 30000);
        }

        // 绑定虚拟控制键事件
        bindVirtualControls();
    }

    // 根据屏幕宽度调整画布大小
    adjustCanvasSize();
}

// 绑定虚拟控制键事件
function bindVirtualControls() {
    document.querySelectorAll('.vc-btn').forEach(btn => {
        // 触摸事件
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dir = btn.dataset.dir;
            console.log('触摸方向:', dir);
            handleVirtualControl(dir);
        }, { passive: false });

        // 点击事件作为后备
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dir = btn.dataset.dir;
            console.log('点击方向:', dir);
            handleVirtualControl(dir);
        });
    });

    // 绑定手势滑动事件
    bindSwipeGestures();
}

// 手势滑动控制
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 30; // 最小滑动距离

function bindSwipeGestures() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    // 触摸开始
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: false });

    // 触摸结束
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;

        // 判断滑动方向
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // 水平滑动
            if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
                if (deltaX > 0) {
                    handleVirtualControl('right');
                } else {
                    handleVirtualControl('left');
                }
            }
        } else {
            // 垂直滑动
            if (Math.abs(deltaY) > SWIPE_THRESHOLD) {
                if (deltaY > 0) {
                    handleVirtualControl('down');
                } else {
                    handleVirtualControl('up');
                }
            }
        }
    }, { passive: false });
}

// 处理虚拟控制键方向
function handleVirtualControl(dir) {
    console.log('handleVirtualControl called, dir:', dir);
    console.log('window.game:', window.game);

    if (!window.game) {
        console.log('游戏未初始化');
        alert('请先登录或开始游戏');
        return;
    }

    const game = window.game;
    console.log('game.isRunning:', game.isRunning);

    // 如果游戏未运行，点击开始游戏
    if (!game.isRunning) {
        console.log('开始游戏, 方向:', dir);
        game.start();
        // 延迟一点设置方向，确保游戏已启动
        setTimeout(() => {
            setDirection(game, dir);
            console.log('方向已设置, game.direction:', game.direction);
        }, 100);
        return;
    }

    // 如果游戏暂停，点击继续
    if (game.isPaused) {
        game.togglePause();
        return;
    }

    // 根据方向控制蛇
    setDirection(game, dir);
    console.log('方向已设置, game.direction:', game.direction);
}

// 设置蛇的方向
function setDirection(game, dir) {
    switch(dir) {
        case 'up':
            if (game.direction.y === 0) game.direction = {x: 0, y: -1};
            break;
        case 'down':
            if (game.direction.y === 0) game.direction = {x: 0, y: 1};
            break;
        case 'left':
            if (game.direction.x === 0) game.direction = {x: -1, y: 0};
            break;
        case 'right':
            if (game.direction.x === 0) game.direction = {x: 1, y: 0};
            break;
    }
}

// 根据屏幕大小调整画布
function adjustCanvasSize() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    const container = canvas.parentElement;
    const containerWidth = container.clientWidth - 20; // 留出边距

    // 原始尺寸
    const maxWidth = 800;
    const maxHeight = 500;

    // 计算缩放比例
    let scale = 1;
    if (containerWidth < maxWidth) {
        scale = containerWidth / maxWidth;
    }

    // 应用缩放
    if (scale < 1) {
        canvas.style.width = (maxWidth * scale) + 'px';
        canvas.style.height = (maxHeight * scale) + 'px';
    } else {
        canvas.style.width = '';
        canvas.style.height = '';
    }

    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        const canvas = document.getElementById('game-canvas');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth - 20;

        let scale = 1;
        if (containerWidth < maxWidth) {
            scale = containerWidth / maxWidth;
        }

        if (scale < 1) {
            canvas.style.width = (maxWidth * scale) + 'px';
            canvas.style.height = (maxHeight * scale) + 'px';
        } else {
            canvas.style.width = '';
            canvas.style.height = '';
        }
    });
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

        // 玩家姓名输入时实时检测冲突和敏感词
        const playerNameInput = document.getElementById('player-name');
        if (playerNameInput) {
            playerNameInput.addEventListener('input', () => {
                const auth = window.auth;
                if (!auth || !auth.currentUser || auth.currentUser === '游客') return;

                const inputName = playerNameInput.value.trim();
                if (inputName && inputName !== '匿名玩家' && inputName !== auth.currentUser) {
                    // 检测敏感词
                    if (auth.checkBadWords && auth.checkBadWords(inputName)) {
                        playerNameInput.setCustomValidity('姓名包含敏感词，请重新输入！');
                    } else if (auth.checkPlayerNameConflict && auth.checkPlayerNameConflict(inputName)) {
                        playerNameInput.setCustomValidity('与其它注册用户名称冲突！');
                    } else {
                        playerNameInput.setCustomValidity('');
                    }
                } else {
                    playerNameInput.setCustomValidity('');
                }
            });

            // 表单提交时检测
            playerNameInput.addEventListener('invalid', () => {
                if (playerNameInput.validity.customError) {
                    const msg = playerNameInput.validationMessage;
                    if (msg.includes('敏感词')) {
                        alert('姓名包含敏感词，请重新输入！');
                    } else {
                        alert('与其它注册用户名称冲突！');
                    }
                }
            });
        }

        // 全屏按钮 - 移动端需要同时绑定 touchend
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        fullscreenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
        });
        fullscreenBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleFullscreen();
        });

        // 防止 iPad 下拉菜单退出全屏
        document.getElementById('game-mode').addEventListener('focus', () => {
            const container = document.querySelector('.game-container');
            if (container.classList.contains('fullscreen-mode')) {
                this._wasInFullscreen = true;
            }
        });
        document.getElementById('game-mode').addEventListener('change', (e) => {
            this.handleModeChange(e.target.value);
            // 尝试恢复全屏
            setTimeout(() => {
                if (this._wasInFullscreen) {
                    const container = document.querySelector('.game-container');
                    if (!container.classList.contains('fullscreen-mode')) {
                        this.toggleFullscreen();
                    }
                    this._wasInFullscreen = false;
                }
            }, 100);
        });

        document.getElementById('clear-records-btn').addEventListener('click', () => this.clearRecords());
        document.getElementById('achievements-btn').addEventListener('click', () => this.showAchievements());
        document.getElementById('skins-btn').addEventListener('click', () => this.showSkins());
        document.getElementById('sound-btn').addEventListener('click', () => this.showSoundSettings());

        // 速度控制
        document.getElementById('game-speed').addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            this.baseSpeed = this.speed;
            document.getElementById('speed-value').textContent = this.getSpeedLabel(this.speed);
            document.getElementById('current-speed').textContent = this.speed;
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
                this.speed = Math.min(20, this.baseSpeed + 1);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('🚗 汽车! 速度+1', true);
                break;
            case 'train': // 高铁 +2
                this.speed = Math.min(20, this.baseSpeed + 2);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('🚄 高铁! 速度+2', true);
                break;
            case 'plane': // 飞机 +3
                this.speed = Math.min(20, this.baseSpeed + 3);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('✈️ 飞机! 速度+3', true);
                break;
            // 减速道具
            case 'snail': // 蜗牛 -3
                this.speed = Math.max(1, this.baseSpeed - 3);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('🐌 蜗牛! 速度-3', false);
                break;
            case 'koala': // 考拉 -2
                this.speed = Math.max(1, this.baseSpeed - 2);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('🐨 考拉! 速度-2', false);
                break;
            case 'turtle': // 乌龟 -1
                this.speed = Math.max(1, this.baseSpeed - 1);
                this.baseSpeed = this.speed;
                document.getElementById('current-speed').textContent = this.speed;
                this.showPowerupNotification('🐢 乌龟! 速度-1', false);
                break;
            case 'speedDown':
                this.activeEffects.speedDown = true;
                this.speed = Math.max(1, this.baseSpeed - 3);
                document.getElementById('current-speed').textContent = this.speed;
                setTimeout(() => {
                    this.activeEffects.speedDown = false;
                    this.speed = this.baseSpeed;
                    document.getElementById('current-speed').textContent = this.speed;
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

    // 速度图标映射
    getSpeedIcon(speed) {
        const icons = ['', '🐢', '🦀', '🦆', '🐱', '🐶', '🐑', '🐒', '🦌', '🐯', '🐆',
                       '🚗', '🚄', '🚁', '🛩️', '💺', '✈️', '🛸', '🚀', '⛴️', '💫'];
        return icons[speed] || speed;
    }

    // 速度图标+文字映射
    getSpeedLabel(speed) {
        const labels = ['', '🐢 龟', '🦀 蟹', '🦆 鸭', '🐱 猫', '🐶 狗', '🐑 羊', '🐒 猴', '🦌 鹿', '🐯 虎', '🐆 豹',
                       '🚗 汽车', '🚄 高铁', '🚁 直升机', '🛩️ 小型飞机', '💺 商务飞机', '✈️ 战斗机', '🛸 航天飞机', '🚀 火箭', '⛴️ 飞船', '💫 光速'];
        return labels[speed] || speed;
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
            case 'forest':
                this.ctx.fillStyle = '#e8f5e9';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillStyle = '#c8e6c9';
                for (let i = 0; i < this.canvas.width; i += 40) {
                    for (let j = 0; j < this.canvas.height; j += 40) {
                        this.ctx.beginPath();
                        this.ctx.arc(i + 20, j + 20, 3, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                }
                break;
            case 'ocean':
                const oceanGrad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
                oceanGrad.addColorStop(0, '#e3f2fd');
                oceanGrad.addColorStop(1, '#bbdefb');
                this.ctx.fillStyle = oceanGrad;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                break;
            case 'sunset':
                const sunsetGrad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
                sunsetGrad.addColorStop(0, '#ffe0b2');
                sunsetGrad.addColorStop(0.5, '#ffcc80');
                sunsetGrad.addColorStop(1, '#ffab91');
                this.ctx.fillStyle = sunsetGrad;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                break;
            case 'night':
                this.ctx.fillStyle = '#1a237e';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                // 使用固定位置的星星，避免每帧闪烁
                if (!this.nightStars) {
                    this.nightStars = [];
                    for (let i = 0; i < 30; i++) {
                        this.nightStars.push({
                            x: Math.random() * this.canvas.width,
                            y: Math.random() * this.canvas.height * 0.7,
                            r: Math.random() * 1.5 + 0.5
                        });
                    }
                }
                this.ctx.fillStyle = '#fff';
                this.nightStars.forEach(star => {
                    this.ctx.beginPath();
                    this.ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
                    this.ctx.fill();
                });
                break;
            case 'pastel':
                const pastelGrad = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
                pastelGrad.addColorStop(0, '#f3e5f5');
                pastelGrad.addColorStop(0.33, '#e8eaf6');
                pastelGrad.addColorStop(0.66, '#e8f5e9');
                pastelGrad.addColorStop(1, '#fff3e0');
                this.ctx.fillStyle = pastelGrad;
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

    // 绘制网格辅助方法
    drawGrid(color = '#bdc3c7') {
        this.ctx.strokeStyle = color;
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

    drawFood(food) {
        const centerX = food.x * this.gridSize + this.gridSize / 2;
        const centerY = food.y * this.gridSize + this.gridSize / 2;
        const size = this.gridSize;

        switch(this.skinSettings.foodStyle) {
            case 'star':
                this.ctx.fillStyle = '#f1c40f';
                this.ctx.font = `${size}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('★', centerX, centerY);
                break;
            case 'heart':
                this.ctx.fillStyle = '#e91e63';
                this.ctx.font = `${size}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('♥', centerX, centerY);
                break;
            case 'fish':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('🐟', centerX, centerY);
                break;
            case 'bug':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('🐛', centerX, centerY);
                break;
            case 'apple':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('🍎', centerX, centerY);
                break;
            case 'diamond':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('💎', centerX, centerY);
                break;
            case 'candy':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('🍬', centerX, centerY);
                break;
            case 'cookie':
                this.ctx.font = `${size - 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('🍪', centerX, centerY);
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
            } else if (colorType === 'purple') {
                fillStyle = index === 0 ? '#8e44ad' : '#9b59b6';
            } else if (colorType === 'orange') {
                fillStyle = index === 0 ? '#d35400' : '#e67e22';
            } else if (colorType === 'pink') {
                fillStyle = index === 0 ? '#e84393' : '#fd79a8';
            } else if (colorType === 'yellow') {
                fillStyle = index === 0 ? '#f39c12' : '#f1c40f';
            } else if (colorType === 'cyan') {
                fillStyle = index === 0 ? '#00b894' : '#00cec9';
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
            this.baseSpeed = Math.min(20, this.baseSpeed + 1);
            this.speed = this.baseSpeed;
            document.getElementById('current-speed').textContent = this.speed;
            document.getElementById('speed-value').textContent = this.getSpeedLabel(this.speed);
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

        // 游戏开始前先从Firebase获取最新数据
        if (window.auth && window.auth.currentUser) {
            console.log('=== 游戏开始 - 从Firebase加载最新数据 ===');
            const currentUser = window.auth.currentUser;

            // 从Firebase读取最新记录
            const recSnapshot = await firebase.database().ref('records').once('value');
            const records = recSnapshot.val() || [];
            localStorage.setItem('snake-records', JSON.stringify(records));
            console.log('加载了 ' + records.length + ' 条记录');

            const topSnapshot = await firebase.database().ref('topRecords').once('value');
            const topRecords = topSnapshot.val() || {};
            localStorage.setItem('snake-top-records', JSON.stringify(Object.values(topRecords)));
            console.log('加载了 ' + Object.keys(topRecords).length + ' 条最高记录');

            // 读取成就
            const achSnapshot = await firebase.database().ref('achievements/' + currentUser).once('value');
            const achievements = achSnapshot.val();
            if (achievements) {
                localStorage.setItem('snake-achievements-' + currentUser, JSON.stringify(achievements));
                console.log('加载了成就数据');
            }

            // 刷新显示
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

        // 检查玩家姓名是否包含敏感词
        const currentPlayerName = document.getElementById('player-name').value;
        const auth = window.auth;

        if (currentPlayerName && currentPlayerName.trim() !== '' && currentPlayerName.trim() !== '匿名玩家') {
            if (auth && auth.checkBadWords && auth.checkBadWords(currentPlayerName)) {
                alert('姓名包含敏感词，请重新输入！');
                return;
            }
        }

        // 检查玩家姓名是否与已注册用户名冲突
        const currentUser = auth ? auth.currentUser : null;
        const isGuest = currentUser === '游客' || localStorage.getItem('snake-current-user') === '游客';

        if (!isGuest && currentPlayerName && currentPlayerName.trim() !== '' && currentPlayerName.trim() !== '匿名玩家') {
            if (auth && auth.checkPlayerNameConflict && auth.checkPlayerNameConflict(currentPlayerName)) {
                alert('与其它注册用户名称冲突！');
                return;
            }
        }

        this.isRunning = true;
        this.isPaused = false;
        this.playerName = currentPlayerName || '匿名玩家';

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
        const isMobile = window.innerWidth < 900 || 'ontouchstart' in window;
        const isFullscreen = document.fullscreenElement ||
                            document.webkitFullscreenElement ||
                            document.msFullscreenElement ||
                            document.mozFullScreenElement;

        console.log('全屏切换 - isFullscreen:', isFullscreen, 'isMobile:', isMobile);

        // 尝试锁定屏幕方向到横屏
        const lockOrientation = async () => {
            if (isMobile && screen.orientation && screen.orientation.lock) {
                try {
                    await screen.orientation.lock('landscape');
                    console.log('横屏锁定成功');
                } catch (e) {
                    console.log('无法锁定横屏:', e.message);
                }
            }
        };

        // 解除屏幕方向锁定
        const unlockOrientation = () => {
            if (screen.orientation && screen.orientation.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (e) {
                    console.log('解锁方向失败:', e.message);
                }
            }
        };

        // 退出全屏
        if (isFullscreen) {
            const exitMethod = document.exitFullscreen ||
                              document.webkitExitFullscreen ||
                              document.msExitFullscreen ||
                              document.mozCancelFullScreen;
            if (exitMethod) {
                exitMethod.call(document);
                unlockOrientation();
                container.classList.remove('fullscreen-mode');
                container.classList.remove('mobile-fullscreen');
                document.getElementById('fullscreen-btn').textContent = '全屏';
                // 隐藏解锁按钮
                const unlockBtn = document.getElementById('unlock-orientation-btn');
                if (unlockBtn) unlockBtn.style.display = 'none';
                // 重新显示提示
                const vcTip = document.getElementById('vc-tip');
                if (vcTip) vcTip.style.display = 'block';
                this.checkOrientation();
            }
            return;
        }

        // 进入全屏 - 尝试多种API
        const tryRequestFullscreen = (method) => {
            return new Promise((resolve) => {
                try {
                    const result = method.call(container);
                    // webkit 返回 true，其他返回 Promise
                    if (result && result.then) {
                        result.then(() => resolve(true)).catch((e) => {
                            console.log('全屏失败:', e.message);
                            resolve(false);
                        });
                    } else {
                        resolve(result !== false);
                    }
                } catch (e) {
                    console.log('全屏请求异常:', e.message);
                    resolve(false);
                }
            });
        };

        // 依次尝试各种全屏API
        const requestFullscreen = async () => {
            if (container.requestFullscreen) {
                if (await tryRequestFullscreen(container.requestFullscreen)) return true;
            }
            if (container.webkitRequestFullscreen) {
                if (await tryRequestFullscreen(container.webkitRequestFullscreen)) return true;
            }
            if (container.msRequestFullscreen) {
                if (await tryRequestFullscreen(container.msRequestFullscreen)) return true;
            }
            if (container.mozRequestFullScreen) {
                if (await tryRequestFullscreen(container.mozRequestFullScreen)) return true;
            }
            return false;
        };

        // 执行全屏请求
        requestFullscreen().then((success) => {
            if (success) {
                container.classList.add('fullscreen-mode');
                if (isMobile) {
                    container.classList.add('mobile-fullscreen');
                }
                document.getElementById('fullscreen-btn').textContent = '退出全屏';
                // 全屏时隐藏提示
                const vcTip = document.getElementById('vc-tip');
                if (vcTip) vcTip.style.display = 'none';
                lockOrientation();
            } else {
                // 全屏API失败，至少锁定方向
                console.log('全屏API失败，尝试锁定方向');
                lockOrientation();
                // 即使全屏失败，也让容器全屏显示
                container.classList.add('fullscreen-mode');
                if (isMobile) {
                    container.classList.add('mobile-fullscreen');
                }
                document.getElementById('fullscreen-btn').textContent = '退出全屏';
                // 全屏时隐藏提示
                const vcTip2 = document.getElementById('vc-tip');
                if (vcTip2) vcTip2.style.display = 'none';

                // 显示解锁屏幕按钮（仅移动设备）
                if (isMobile) {
                    const unlockBtn = document.getElementById('unlock-orientation-btn');
                    if (unlockBtn) {
                        unlockBtn.style.display = 'block';
                        unlockBtn.onclick = () => {
                            if (screen.orientation && screen.orientation.unlock) {
                                screen.orientation.unlock();
                                unlockBtn.style.display = 'none';
                            }
                        };
                    }
                }
            }
            this.checkOrientation();
        });

        // 延迟检测方向（等待全屏过渡完成）
        setTimeout(() => this.checkOrientation(), 100);

        // 监听全屏变化
        this.setupFullscreenListener();
    }

    setupFullscreenListener() {
        const container = document.querySelector('.game-container');
        const rotateHint = document.getElementById('rotate-hint');

        const handleFullscreenChange = () => {
            const isFullscreen = document.fullscreenElement ||
                                document.webkitFullscreenElement ||
                                document.mozFullScreenElement;

            if (!isFullscreen) {
                container.classList.remove('fullscreen-mode');
                container.classList.remove('mobile-fullscreen');
                if (rotateHint) rotateHint.classList.remove('show');
            } else {
                // 检测横竖屏
                this.checkOrientation();
            }
        };

        const handleOrientationChange = () => {
            if (document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.mozFullScreenElement) {
                this.checkOrientation();
            }
        };

        document.removeEventListener('fullscreenchange', handleFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.removeEventListener('orientationchange', handleOrientationChange);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('orientationchange', handleOrientationChange);
    }

    checkOrientation() {
        const container = document.querySelector('.game-container');
        const rotateHint = document.getElementById('rotate-hint');
        const isLandscape = window.innerWidth > window.innerHeight;

        if (!isLandscape && container.classList.contains('mobile-fullscreen')) {
            // 竖屏显示旋转提示
            if (rotateHint) rotateHint.classList.add('show');
        } else {
            // 横屏隐藏提示
            if (rotateHint) rotateHint.classList.remove('show');
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

        // 保存记录（等待完成）
        await this.saveRecord();
        console.log('=== 游戏结束 - 保存记录完成 ===');

        // 立即从 Firebase 读取最新数据并显示（确保多玩家同步）
        const auth = window.auth;
        const currentUser = auth ? auth.currentUser : null;
        if (auth && currentUser) {
            // 从 Firebase 读取最新记录
            firebase.database().ref('records').once('value', (snapshot) => {
                const records = snapshot.val() || [];
                localStorage.setItem('snake-records', JSON.stringify(records));
                console.log('从Firebase刷新记录: ' + records.length + ' 条');

                // 读取最新最高记录
                firebase.database().ref('topRecords').once('value', (topSnapshot) => {
                    const topRecords = topSnapshot.val() || {};
                    localStorage.setItem('snake-top-records', JSON.stringify(Object.values(topRecords)));
                    console.log('从Firebase刷新最高记录: ' + Object.values(topRecords).length + ' 条');

                    this.displayRecords();
                    console.log('=== 记录显示已刷新 ===');
                });
            });
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

    async saveRecord() {
        const records = this.loadRecords();
        const topRecords = this.loadTopRecords();
        const auth = window.auth;
        const currentUser = auth ? auth.currentUser : null;
        const currentPlayerName = document.getElementById('player-name').value;

        // 判断是否是游客模式
        const isGuest = currentUser === '游客' || localStorage.getItem('snake-current-user') === '游客';
        console.log('保存记录 - currentUser:', currentUser, 'isGuest:', isGuest, 'playerName:', this.playerName);

        // 游客模式下，显示为 "玩家姓名-游客"（如果没有填姓名则显示"游客"）
        let displayName = this.playerName;
        if (isGuest) {
            // 游客模式下总是添加 -游客 后缀
            if (this.playerName && this.playerName.trim() !== '' && this.playerName !== '匿名玩家') {
                displayName = this.playerName.trim() + '-游客';
            } else {
                displayName = '游客';
            }
        }

        // 登录用户模式下如果没有输入姓名，显示"匿名玩家"
        // 注意：从输入框实时获取值，因为 showGame 会自动填充用户名
        const playerNameForRecord = isGuest ? displayName :
            (currentPlayerName && currentPlayerName.trim() !== '' ? currentPlayerName : '匿名玩家');

        const record = {
            username: isGuest ? displayName : (currentPlayerName && currentPlayerName.trim() !== '' ? currentPlayerName : '匿名玩家'),
            playerName: this.isTwoPlayerMode ? (this.p1Score >= this.p2Score ? 'P1' : 'P2') : playerNameForRecord,
            score: this.isTwoPlayerMode ? Math.max(this.p1Score, this.p2Score) : this.score,
            mode: document.getElementById('game-mode').value,
            time: this.gameTime - this.timeRemaining,
            date: new Date().toLocaleString('zh-CN')
        };

        console.log('saveRecord - 保存的记录:', JSON.stringify(record));
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

        // 等待保存到 Firebase 完成
        await this.saveTopRecords(uniqueTop);
        await this.saveRecords(records);

        // 同时保存到"我的记录"（单独的存储）
        if (isGuest) {
            // 游客：保存到游客记录存储
            const guestRecords = JSON.parse(localStorage.getItem('snake-guest-records') || '[]');
            guestRecords.push(record);
            guestRecords.sort((a, b) => b.score - a.score);
            if (guestRecords.length > 50) guestRecords.splice(50);
            localStorage.setItem('snake-guest-records', JSON.stringify(guestRecords));
        } else {
            // 登录用户：保存到我的记录存储
            const myRecordsKey = 'snake-my-records-' + currentUser;
            const myRecords = JSON.parse(localStorage.getItem(myRecordsKey) || '[]');
            myRecords.push(record);
            myRecords.sort((a, b) => b.score - a.score);
            if (myRecords.length > 50) myRecords.splice(50);
            localStorage.setItem(myRecordsKey, JSON.stringify(myRecords));
        }

        // 保存完成后显示
        this.displayRecords();
    }

    loadTopRecords() {
        const records = localStorage.getItem('snake-top-records');
        return records ? JSON.parse(records) : [];
    }

    async saveTopRecords(records) {
        localStorage.setItem('snake-top-records', JSON.stringify(records));

        // 保存到 Firebase（转换为对象格式）
        const topRecordsObj = {};
        records.forEach((r, i) => {
            topRecordsObj['-' + Date.now() + i] = r;
        });
        try {
            await firebase.database().ref('topRecords').set(topRecordsObj);
            console.log('最高记录已保存到 Firebase');
        } catch (e) {
            console.log('保存最高记录到 Firebase 失败:', e.message);
        }
    }

    loadRecords() {
        // 从本地加载（登录时已从Firebase同步）
        const records = localStorage.getItem('snake-records');
        return records ? JSON.parse(records) : [];
    }

    // 获取当前用户的记录
    getUserRecords() {
        const allRecords = this.loadRecords();
        const auth = window.auth;
        const currentUser = auth ? auth.currentUser : null;
        const isGuest = currentUser === '游客' || localStorage.getItem('snake-current-user') === '游客';

        console.log('getUserRecords - currentUser:', currentUser, 'isGuest:', isGuest, 'totalRecords:', allRecords.length);

        // 未登录且非游客模式时返回空
        if (!currentUser && localStorage.getItem('snake-current-user') !== '游客') {
            console.log('getUserRecords - 未登录且非游客模式，返回空');
            return [];
        }

        // 游客模式：从单独的游客记录存储中读取
        if (isGuest) {
            const guestRecords = JSON.parse(localStorage.getItem('snake-guest-records') || '[]');
            console.log('getUserRecords - 游客模式，找到', guestRecords.length, '条记录');
            return guestRecords;
        }

        // 登录用户：从单独的我的记录存储中读取
        const myRecordsKey = 'snake-my-records-' + currentUser;
        const userRecords = JSON.parse(localStorage.getItem(myRecordsKey) || '[]');
        console.log('getUserRecords - 正常用户模式，找到', userRecords.length, '条记录');
        return userRecords;
    }

    async saveRecords(records) {
        localStorage.setItem('snake-records', JSON.stringify(records));

        // 保存到 Firebase 并等待完成
        try {
            await firebase.database().ref('records').set(records);
            console.log('游戏记录已保存到 Firebase');
        } catch (e) {
            console.log('保存记录到 Firebase 失败:', e.message);
        }
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

        // 分页设置
        const pageSize = 20;
        if (!this.allRecordsPage) this.allRecordsPage = 1;
        if (!this.myRecordsPage) this.myRecordsPage = 1;

        // 全部玩家记录（分页）
        const allRecordsList = document.getElementById('records-list-all');
        const totalAllPages = Math.ceil(combinedRecords.length / pageSize) || 1;
        const allStart = (this.allRecordsPage - 1) * pageSize;
        const allEnd = allStart + pageSize;
        const allPageRecords = combinedRecords.slice(allStart, allEnd);

        if (combinedRecords.length === 0) {
            allRecordsList.innerHTML = '<div class="record-item">暂无记录</div>';
        } else {
            allRecordsList.innerHTML = '';
            allPageRecords.forEach((record, index) => {
                const realIndex = allStart + index;
                const recordItem = document.createElement('div');
                recordItem.className = 'record-item';
                if (realIndex < 3) recordItem.classList.add('highlight');

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

            // 添加分页控件
            if (combinedRecords.length > pageSize) {
                allRecordsList.innerHTML += this.createPaginationHTML('all', this.allRecordsPage, totalAllPages);
            }
        }

        // 我的记录（分页）
        const myRecords = this.getUserRecords();
        const myRecordsList = document.getElementById('records-list-mine');
        const totalMyPages = Math.ceil(myRecords.length / pageSize) || 1;
        const myStart = (this.myRecordsPage - 1) * pageSize;
        const myEnd = myStart + pageSize;
        const myPageRecords = myRecords.slice(myStart, myEnd);

        if (myRecords.length === 0) {
            myRecordsList.innerHTML = '<div class="record-item">暂无记录</div>';
        } else {
            myRecordsList.innerHTML = '';
            myPageRecords.forEach((record, index) => {
                const realIndex = myStart + index;
                const recordItem = document.createElement('div');
                recordItem.className = 'record-item';
                if (realIndex < 3) recordItem.classList.add('highlight');

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

            // 添加分页控件
            if (myRecords.length > pageSize) {
                myRecordsList.innerHTML += this.createPaginationHTML('my', this.myRecordsPage, totalMyPages);
            }
        }
    }

    // 创建分页 HTML
    createPaginationHTML(type, currentPage, totalPages) {
        let html = '<div class="pagination" style="display:flex;justify-content:center;align-items:center;margin-top:15px;gap:5px;flex-wrap:wrap;">';

        // 首页
        if (currentPage > 1) {
            html += `<button class="page-btn" data-type="${type}" data-page="1">首页</button>`;
        }

        // 上一页 <
        if (currentPage > 1) {
            html += `<button class="page-btn" data-type="${type}" data-page="${currentPage - 1}">&lt;</button>`;
        }

        // 页码（最多显示10个，中间用省略号）
        const maxPages = 10;
        let startPage = 1;
        let endPage = totalPages;

        if (totalPages > maxPages) {
            const half = Math.floor(maxPages / 2);
            startPage = Math.max(1, currentPage - half);
            endPage = Math.min(totalPages, currentPage + half);

            if (currentPage <= half) {
                endPage = maxPages;
            } else if (currentPage >= totalPages - half) {
                startPage = totalPages - maxPages + 1;
            }
        }

        // 前面省略号
        if (startPage > 1) {
            html += `<button class="page-btn" data-type="${type}" data-page="1">1</button>`;
            if (startPage > 2) {
                html += `<span style="color:#999;padding:0 5px;">...</span>`;
            }
        }

        // 中间页码
        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                html += `<span style="color:#667eea;font-weight:bold;padding:0 8px;">${i}</span>`;
            } else {
                html += `<button class="page-btn" data-type="${type}" data-page="${i}">${i}</button>`;
            }
        }

        // 后面省略号
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `<span style="color:#999;padding:0 5px;">...</span>`;
            }
            html += `<button class="page-btn" data-type="${type}" data-page="${totalPages}">${totalPages}</button>`;
        }

        // 下一页 >
        if (currentPage < totalPages) {
            html += `<button class="page-btn" data-type="${type}" data-page="${currentPage + 1}">&gt;</button>`;
        }

        // 尾页
        if (currentPage < totalPages) {
            html += `<button class="page-btn" data-type="${type}" data-page="${totalPages}">尾页</button>`;
        }

        html += '</div>';

        // 添加点击事件
        setTimeout(() => {
            document.querySelectorAll('.page-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const btnType = e.target.dataset.type;
                    const page = parseInt(e.target.dataset.page);
                    if (btnType === 'all') {
                        this.allRecordsPage = page;
                    } else {
                        this.myRecordsPage = page;
                    }
                    this.displayRecords();
                });
            });
        }, 100);

        return html;
    }

    async clearRecords() {
        // 获取当前用户名
        const currentUser = window.auth ? window.auth.currentUser : null;
        const playerName = document.getElementById('player-name').value;
        const isGuest = currentUser === '游客' || localStorage.getItem('snake-current-user') === '游客';

        if (!currentUser && !playerName && !isGuest) {
            alert('请先登录或输入玩家姓名');
            return;
        }

        // 确认一次即可
        const userToDelete = currentUser || playerName;
        if (!confirm('确定要清除「' + userToDelete + '」的游戏记录吗？')) {
            return;
        }

        // 清除我的记录（不影响全部玩家记录）
        if (isGuest) {
            // 游客模式：清空游客记录存储
            localStorage.removeItem('snake-guest-records');
        } else {
            // 登录用户：清空该用户的记录（用单独的存储）
            const myRecordsKey = 'snake-my-records-' + currentUser;
            localStorage.removeItem(myRecordsKey);
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

        // 保存到 Firebase
        if (currentUser) {
            firebase.database().ref('achievements/' + currentUser).set(this.achievements)
                .then(() => console.log('成就已保存到 Firebase'))
                .catch(e => console.log('保存成就到Firebase失败:', e.message));
        }
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
        notification.textContent = `⚡ 速度提升! 当前速度: ${this.getSpeedIcon(speed)}`;
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

        // 背景改变时重置星星位置
        if (this.skinSettings && this.skinSettings.bgStyle !== bgStyle) {
            this.nightStars = null;
        }

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
