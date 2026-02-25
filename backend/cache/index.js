// 共享缓存模块，解决循环依赖问题

// WebSocket客户端缓存
const connectedClients = new Map();

// 用户信息缓存
const userInfoCache = new Map();

// 用户设备缓存
const userDeviceCache = new Map();

// 用户MQTT客户端缓存
const userMqttClients = new Map();

// 用户报警订阅状态
const userAlarmSubscribed = new Map();

// 历史报警查询映射
const historyAlarmQueryMap = new Map();

module.exports = {
  connectedClients,
  userInfoCache,
  userDeviceCache,
  userMqttClients,
  userAlarmSubscribed,
  historyAlarmQueryMap
};
