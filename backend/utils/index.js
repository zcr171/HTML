const { FACTORY_MAP, FACTORY_TOPIC_MAP } = require('../config');
const { connectedClients } = require('../cache');

// 解析工厂权限等级
function parseFactoryLevel(factoryLevel) {
  if (factoryLevel === 99) {
    // 超级管理员返回所有工厂
    return Object.values(FACTORY_MAP);
  }

  const factories = [];
  for (const [factory, value] of Object.entries(FACTORY_MAP)) {
    if ((factoryLevel & value) === value) {
      factories.push(value);
    }
  }
  return factories;
}

// 工厂权限转换为MQTT主题
function factoriesToTopics(factories) {
  return factories.map(factory => FACTORY_TOPIC_MAP[factory]).filter(Boolean);
}

// 向指定用户发送WebSocket消息
function sendToUser(userId, message) {
  const client = connectedClients.get(userId);
  if (client && client.readyState === client.OPEN) {
    try {
      const messageStr = JSON.stringify(message);
      client.send(messageStr);
      console.log(`已向用户 ${userId} 发送WebSocket消息，长度: ${messageStr.length} 类型: ${message.type}`);
    } catch (error) {
      console.error('发送WebSocket消息失败:', error);
    }
  } else {
    console.log(`用户 ${userId} 没有在线的WebSocket连接，消息未发送`);
  }
}

// 全局错误捕获
function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (error) => {
    console.error('全局未捕获异常:', error);
    console.error('异常堆栈:', error.stack);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    if (reason && reason.stack) {
      console.error('拒绝原因堆栈:', reason.stack);
    }
  });
}

module.exports = {
  parseFactoryLevel,
  factoriesToTopics,
  sendToUser,
  setupGlobalErrorHandlers
};
