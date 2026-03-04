// 贪吃蛇游戏核心逻辑
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
        this.isRunning = false;
        this.isPaused = false;
        this.timeRemaining = this.gameTime;
        this.playerName = '';
        this.gameTimer = null;
        this.speedTimer = null;

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

            switch(e.key) {
                case 'ArrowUp':
                    if (this.direction.y === 0) this.direction = {x: 0, y: -1};
                    break;
                case 'ArrowDown':
                    if (this.direction.y === 0) this.direction = {x: 0, y: 1};
                    break;
                case 'ArrowLeft':
                    if (this.direction.x === 0) this.direction = {x: -1, y: 0};
                    break;
                case 'ArrowRight':
                    if (this.direction.x === 0) this.direction = {x: 1, y: 0};
                    break;
                case 'f':
                case 'F':
                    this.toggleFullscreen();
                    break;
            }
        });

        // 按钮控制
        document.getElementById('start-btn').addEventListener('click', () => this.start());
        document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('clear-records-btn').addEventListener('click', () => this.clearRecords());

        // 速度控制
        document.getElementById('game-speed').addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            document.getElementById('speed-value').textContent = this.speed;
        });
    }

    generateFood() {
        const x = Math.floor(Math.random() * (this.canvas.width / this.gridSize));
        const y = Math.floor(Math.random() * (this.canvas.height / this.gridSize));
        return {x, y};
    }

    draw() {
        // 清空画布
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

        // 绘制蛇
        this.snake.forEach((segment, index) => {
            this.ctx.fillStyle = index === 0 ? '#27ae60' : '#2ecc71';
            this.ctx.fillRect(
                segment.x * this.gridSize,
                segment.y * this.gridSize,
                this.gridSize - 2,
                this.gridSize - 2
            );
        });

        // 绘制食物
        this.ctx.fillStyle = '#e74c3c';
        this.ctx.beginPath();
        this.ctx.arc(
            this.food.x * this.gridSize + this.gridSize/2,
            this.food.y * this.gridSize + this.gridSize/2,
            this.gridSize/2 - 2,
            0,
            Math.PI * 2
        );
        this.ctx.fill();

        // 绘制分数
        this.ctx.fillStyle = '#2c3e50';
        this.ctx.font = '20px Arial';
        this.ctx.fillText(`分数: ${this.score}`, 10, 30);
        this.ctx.fillText(`时间: ${this.timeRemaining}s`, 10, 55);
    }

    move() {
        if (!this.isRunning || this.isPaused) return;

        // 移动蛇头
        const head = {...this.snake[0]};
        head.x += this.direction.x;
        head.y += this.direction.y;

        // 检查边界碰撞
        if (head.x < 0 || head.x >= this.canvas.width / this.gridSize ||
            head.y < 0 || head.y >= this.canvas.height / this.gridSize) {
            this.gameOver();
            return;
        }

        // 检查自身碰撞
        for (let i = 0; i < this.snake.length; i++) {
            if (head.x === this.snake[i].x && head.y === this.snake[i].y) {
                this.gameOver();
                return;
            }
        }

        // 检查食物碰撞
        if (head.x === this.food.x && head.y === this.food.y) {
            this.score += 10 + this.speed * 2;
            this.food = this.generateFood();
        } else {
            this.snake.pop(); // 移除尾部
        }

        this.snake.unshift(head); // 添加新头部
    }

    update() {
        this.move();
        this.draw();
    }

    gameLoop() {
        if (!this.isRunning || this.isPaused) return;

        this.update();
        this.speedTimer = setTimeout(() => this.gameLoop(), 1000 / this.speed);
    }

    start() {
        // 如果游戏正在运行但暂停中，先停止现有游戏再重新开始
        if (this.isRunning) {
            clearInterval(this.gameTimer);
            clearTimeout(this.speedTimer);
        }

        // 重置游戏状态
        this.snake = [{x: 10, y: 10}];
        this.direction = {x: 1, y: 0};
        this.food = this.generateFood();
        this.score = 0;
        this.gameTime = parseInt(document.getElementById('game-time').value) || 0;
        this.timeRemaining = this.gameTime;
        this.isRunning = true;
        this.isPaused = false;
        this.playerName = document.getElementById('player-name').value || '匿名玩家';

        // 更新UI
        document.getElementById('start-btn').textContent = '重新开始';
        document.getElementById('score').textContent = '0';
        document.getElementById('pause-btn').disabled = false;
        document.getElementById('game-time').disabled = true;
        document.getElementById('game-speed').disabled = true;

        // 开始游戏循环
        this.gameLoop();

        // 开始计时器
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

    pause() {
        this.isPaused = !this.isPaused;
        if (this.isPaused) {
            document.getElementById('pause-btn').textContent = '继续';
        } else {
            document.getElementById('pause-btn').textContent = '暂停';
            // 恢复游戏循环
            this.gameLoop();
        }
    }

    togglePause() {
        if (this.isRunning) {
            this.pause();
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    gameOver() {
        this.isRunning = false;
        this.isPaused = false;

        // 停止计时器
        clearInterval(this.gameTimer);
        clearTimeout(this.speedTimer);

        // 显示游戏结束
        alert(`游戏结束！\n玩家: ${this.playerName}\n最终分数: ${this.score}\n用时: ${this.gameTime - this.timeRemaining}秒`);

        // 保存记录
        this.saveRecord();

        // 重置UI
        document.getElementById('start-btn').textContent = '开始游戏';
        document.getElementById('pause-btn').disabled = true;
        document.getElementById('game-time').disabled = false;
        document.getElementById('game-speed').disabled = false;
        document.getElementById('time-remaining').textContent = this.gameTime;
    }

    saveRecord() {
        console.log('正在保存游戏记录...');
        const records = this.loadRecords();
        const record = {
            playerName: this.playerName,
            score: this.score,
            time: this.gameTime - this.timeRemaining,
            date: new Date().toLocaleString('zh-CN')
        };

        // 添加当前记录
        records.push(record);

        // 排序并截取前10条记录
        records.sort((a, b) => b.score - a.score);
        if (records.length > 10) {
            records.splice(10);
        }

        // 保存记录
        this.saveRecords(records);
        console.log('记录已保存到localStorage');
        this.displayRecords();
    }

    loadRecords() {
        const records = localStorage.getItem('snake-records');
        return records ? JSON.parse(records) : [];
    }

    saveRecords(records) {
        localStorage.setItem('snake-records', JSON.stringify(records));
    }

    displayRecords() {
        const recordsList = document.getElementById('records-list');
        const records = this.loadRecords();
        recordsList.innerHTML = '';

        if (records.length === 0) {
            recordsList.innerHTML = '<div class="record-item">暂无记录</div>';
            return;
        }

        recordsList.innerHTML = '';
        records.forEach((record, index) => {
            const recordItem = document.createElement('div');
            recordItem.className = 'record-item';
            if (index === 0) recordItem.classList.add('highlight');

            recordItem.innerHTML = `
                <strong>${record.playerName}</strong><br>
                分数: ${record.score} | 时间: ${record.time}s | ${record.date}
            `;
            recordsList.appendChild(recordItem);
        });
    }

    clearRecords() {
        this.saveRecords([]);
        this.displayRecords();
        console.log('记录已清除');
    }
}

// 初始化游戏
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const game = new SnakeGame(canvas, ctx);

    // 初始显示记录
    game.displayRecords();
});