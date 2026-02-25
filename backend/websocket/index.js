const WebSocket = require('ws');
const { getUserById, getUserDevices } = require('../db');
const { parseFactoryLevel, factoriesToTopics } = require('../utils');
const { initMQTTClient } = require('../mqtt');
const { connectedClients, userInfoCache, userDeviceCache, userMqttClients, userAlarmSubscribed, historyAlarmQueryMap } = require('../cache');


let wss = null;

// 初始化WebSocket服务器
function initWebSocketServer(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', async (ws, req) => {
    console.log('新的WebSocket客户端连接');
    
    // 从查询参数获取用户ID
    let userId = null;
    try {
      const queryString = req.url.split('?')[1];
      if (queryString) {
        const urlParams = new URLSearchParams(queryString);
        userId = urlParams.get('userId');
      }
    } catch (error) {
      console.error('解析WebSocket查询参数失败:', error);
    }
    
    if (userId) {
      // 如果用户已经有连接，先关闭旧连接
      if (connectedClients.has(userId)) {
        try {
          const oldWs = connectedClients.get(userId);
          oldWs.close();
          console.log(`用户 ${userId} 已有旧连接，已关闭`);
        } catch (e) {
          console.error('关闭旧连接失败:', e);
        }
      }
      
      connectedClients.set(userId, ws);
      console.log(`用户 ${userId} WebSocket连接成功`);
      
      // 如果用户还没有MQTT客户端，自动初始化
      if (!userMqttClients.has(userId)) {
        console.log(`用户 ${userId} 尚未初始化MQTT，自动初始化中...`);
        try {
          // 如果用户信息不在缓存，从数据库查询
          let userInfo = null;
          if (userInfoCache.has(userId)) {
            userInfo = userInfoCache.get(userId);
          } else {
            userInfo = await getUserById(userId);
            if (userInfo) {
              userInfoCache.set(userId, userInfo);
              console.log(`查询到用户 ${userId} 信息，factory_level:`, userInfo.factory_level);
            }
          }
          
          if (userInfo) {
            const factories = parseFactoryLevel(userInfo.factory_level);
            console.log(`解析到工厂权限:`, factories);
            const mqttTopics = factoriesToTopics(factories);
            console.log(`生成MQTT主题:`, mqttTopics);
            initMQTTClient(userId, mqttTopics);
            
            // 同时查询用户的设备权限并缓存
            if (!userDeviceCache.has(userId)) {
              console.log(`用户 ${userId} 尚未缓存设备权限，开始查询...`);
              const isSuperAdmin = userInfo.factory_level === 99;
              const devices = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
              const deviceSet = new Set(devices.map(d => d.device_no));
              userDeviceCache.set(userId, deviceSet);
              console.log(`用户 ${userId} 设备权限缓存完成，共 ${devices.length} 个设备`);
            }
          }
        } catch (e) {
          console.error('初始化MQTT和设备权限失败:', e);
        }
      } else {
        console.log(`用户 ${userId} 已有MQTT客户端，无需重复初始化`);
        // 确保设备权限已缓存
        if (!userDeviceCache.has(userId)) {
          try {
            const userInfo = userInfoCache.get(userId);
            if (userInfo) {
              const factories = parseFactoryLevel(userInfo.factory_level);
              const isSuperAdmin = userInfo.factory_level === 99;
              const devices = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
              const deviceSet = new Set(devices.map(d => d.device_no));
              userDeviceCache.set(userId, deviceSet);
              console.log(`用户 ${userId} 设备权限缓存完成，共 ${devices.length} 个设备`);
            }
          } catch (e) {
            console.error('缓存设备权限失败:', e);
          }
        }
      }
    }
    
    // 发送连接成功消息
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket连接成功'
    }));
    
    // 处理连接关闭
    ws.on('close', () => {
      console.log('WebSocket客户端断开连接');
      if (userId && connectedClients.get(userId) === ws) {
        connectedClients.delete(userId);
        // 不关闭MQTT客户端，保持订阅
      }
    });
    
    // 处理消息
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('收到WebSocket消息:', data);
        
        // 处理发布MQTT消息请求
        if (data.type === 'publish_mqtt' && data.topic && data.payload) {
          const mqttClient = userMqttClients.get(userId);
          if (mqttClient && mqttClient.connected) {
            // 历史查询通用处理（报警+数据）
            if (data.topic === 'SupconScadaHisAlarm' || data.topic === 'SupconScadaHisData') {
              const isAlarm = data.topic === 'SupconScadaHisAlarm';
              if (isAlarm) {
                console.log('✅ 历史报警查询用户ID已记录:', userId);
              }
              
              // 保存seq->用户ID映射，解决多用户并发串数据
              const seq = data.payload.seq;
              if (seq !== undefined) {
                historyAlarmQueryMap.set(seq, userId);
                console.log(`✅ 历史查询映射已保存 seq:${seq} -> 用户ID:${userId}, 类型:${isAlarm ? '报警' : '数据'}`);
                
                // 1分钟后自动删除过期映射，避免内存泄漏
                setTimeout(() => {
                  historyAlarmQueryMap.delete(seq);
                }, 60 * 1000);
              }
              
              console.log(`✅ 历史查询请求已发送 主题:${data.topic}`);
              
              // 发布消息到MQTT服务器
              mqttClient.publish(data.topic, JSON.stringify(data.payload), (err) => {
                if (err) {
                  console.error(`发布MQTT消息失败 主题:${data.topic}`, err);
                } else {
                  console.log(`成功发布历史查询请求 主题:${data.topic}`);
                }
              });
            }
          } else {
            console.error(`用户 ${userId} MQTT客户端未连接`);
          }
        }
        
        // 处理报警订阅/取消订阅请求
        else if (data.type === 'alarm_subscribe' && data.state !== undefined) {
          const isSubscribe = data.state === 0;
          console.log(`用户 ${userId} 请求${isSubscribe ? '订阅' : '取消订阅'}实时报警`);
          
          // 更新用户订阅状态
          if (isSubscribe) {
            userAlarmSubscribed.set(userId, true);
            console.log(`✅ 用户 ${userId} 已订阅实时报警`);
          } else {
            userAlarmSubscribed.delete(userId);
            console.log(`✅ 用户 ${userId} 已取消订阅实时报警`);
          }
        }
      } catch (error) {
        console.error('解析WebSocket消息失败:', error);
      }
    });

    // 处理错误
    ws.on('error', (error) => {
      console.error('WebSocket连接错误:', error);
    });
  });

  console.log('WebSocket server running on ws://localhost:' + (process.env.PORT || 3003));
  return wss;
}

module.exports = {
  initWebSocketServer
};

