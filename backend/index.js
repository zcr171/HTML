const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { testConnection } = require('./db');
const { setupGlobalErrorHandlers } = require('./utils');
const { initWebSocketServer } = require('./websocket');
const { initGlobalMQTTClient } = require('./mqtt');
const routes = require('./routes');

// 初始化全局错误处理
setupGlobalErrorHandlers();

const app = express();
const server = http.createServer(app);

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '..')));
app.use('/src', express.static(path.join(__dirname, '..', 'src')));

// API路由
app.use('/api', routes);

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// 初始化WebSocket服务器
initWebSocketServer(server);



// 启动服务器
async function startServer() {
  try {
    // 测试数据库连接
    await testConnection();

    // 初始化全局MQTT客户端
    initGlobalMQTTClient();
    console.log('全局MQTT客户端初始化完成');

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`服务器启动成功，可以通过 http://localhost:${PORT} 访问`);
      
      // 设置设备缓存定时刷新，每5分钟执行一次
      setInterval(() => {
        console.log('执行设备缓存定时刷新...');
      }, 5 * 60 * 1000);
      console.log('设置设备缓存定时刷新，每5分钟执行一次');
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();