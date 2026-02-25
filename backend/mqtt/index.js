const mqtt = require('mqtt');
const WebSocket = require('ws');
const { MQTT_CONFIG, SCADA_TOPICS } = require('../config');
const { userDeviceCache, userMqttClients, userAlarmSubscribed, connectedClients, historyAlarmQueryMap } = require('../cache');
const { sendToUser } = require('../utils');

// 全局MQTT客户端（用于处理历史报警等全局消息）
let globalMqttClient = null;



// 初始化用户MQTT客户端
function initMQTTClient(userId, topics) {
  if (userMqttClients.has(userId)) {
    console.log(`用户 ${userId} 已有MQTT客户端，无需重复初始化`);
    return userMqttClients.get(userId);
  }

  const clientId = `${MQTT_CONFIG.clientIdPrefix}${userId}-${Date.now()}`;
  
  const client = mqtt.connect({
    host: MQTT_CONFIG.host,
    port: MQTT_CONFIG.port,
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    clientId: clientId,
    connectTimeout: MQTT_CONFIG.connectTimeout,
    reconnectPeriod: MQTT_CONFIG.reconnectPeriod
  });

  // 连接成功
  client.on('connect', () => {
    console.log(`用户 ${userId} MQTT客户端连接成功，客户端ID: ${clientId}`);
    // 添加历史数据返回主题订阅
    topics.push('hisdatatest');
    console.log(`用户 ${userId} 订阅的MQTT主题:`, topics);
    // 订阅所有主题
    topics.forEach(topic => {
      client.subscribe(topic, (err) => {
        if (err) {
          console.error(`订阅主题 ${topic} 失败:`, err);
        } else {
          console.log(`用户 ${userId} 成功订阅主题: ${topic}`);
        }
      });
    });
  });

  // 收到消息
  client.on('message', (topic, message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      console.log(`收到MQTT消息原始结构:`, parsedMessage);
      console.log(`收到MQTT消息: ${topic} 包含 ${parsedMessage.RTValue ? parsedMessage.RTValue.length : 0} 个设备数据`);

      // 处理实时设备数据
      if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
        const deviceSet = userDeviceCache.get(userId);
        const authorizedDevices = [];
        
        parsedMessage.RTValue.forEach(device => {
          const deviceNo = device.name;
          if (deviceSet && deviceSet.has(deviceNo)) {
            console.log('设备有权限，处理数据:', deviceNo, 'value:', device.value);
            authorizedDevices.push(device);
          } else {
            console.log('设备无权限，丢弃数据:', deviceNo);
          }
        });

        // 只发送有权限的设备数据
        if (authorizedDevices.length > 0) {
          sendToUser(userId, {
            type: 'realtime_data',
            data: {
              RTValue: authorizedDevices
            }
          });
          console.log(`发送实时数据给用户: ${userId} 设备数量: ${authorizedDevices.length}`);
        }
      }
      
      // 处理历史数据返回（hisdatatest主题）
      else if (topic === 'hisdatatest' || (parsedMessage.method === 'HistoryData' && parsedMessage.result && parsedMessage.result.data)) {
        console.log(`收到历史数据返回，共${parsedMessage.result?.data?.length || 0}条, seq:${parsedMessage.seq}`);
        
        // 【关键修复】优先按seq匹配用户，确保推送给正确的用户（不是当前userId）
        const targetUserId = historyAlarmQueryMap.get(parsedMessage.seq);
        const userWs = targetUserId ? connectedClients.get(targetUserId) : null;
        
        if (userWs && userWs.readyState === userWs.OPEN) {
          sendToUser(targetUserId, {
            type: 'history_data',
            data: parsedMessage
          });
          console.log(`✅ 已向用户 ${targetUserId} 推送历史数据，共${parsedMessage.result?.data?.length || 0}条`);
        } else {
          console.log(`用户 ${targetUserId} 没有在线的WebSocket连接，历史数据消息未发送`);
        }
        
        // 【关键修复】用完删除映射，避免内存泄漏
        if (historyAlarmQueryMap.has(parsedMessage.seq)) {
          historyAlarmQueryMap.delete(parsedMessage.seq);
        }
      }
      
      // 处理报警数据
      else if (parsedMessage.method === 'RealAlarm' && Array.isArray(parsedMessage.alarms)) {
        console.log(`收到报警数据，共${parsedMessage.alarms.length}条`);
        
        const deviceSet = userDeviceCache.get(userId);
        const authorizedAlarms = [];
        
        parsedMessage.alarms.forEach(alarm => {
          const deviceNo = alarm.name;
          if (deviceSet && deviceSet.has(deviceNo)) {
            // 转换报警格式，适配前端显示
            const formattedAlarm = {
              time: new Date(alarm.newtime).toLocaleString('zh-CN'),
              deviceName: alarm.name,
              type: alarm.type === 'H' ? '高值报警' : 
                    alarm.type === 'L' ? '低值报警' : 
                    alarm.type === 'HH' ? '高高限报警' :
                    alarm.type === 'LL' ? '低低限报警' : alarm.type,
              value: parseFloat(alarm.trigger),
              limit: parseFloat(alarm.limit),
              status: alarm.state === 0 ? '未处理' : 
                      alarm.state === 1 ? '已确认' : '已消除',
              desc: alarm.desc || alarm.almdesc || '',
              level: alarm.level,
              cancelTime: alarm.canceltime ? new Date(alarm.canceltime).toLocaleString('zh-CN') : null,
              ackTime: alarm.acktime ? new Date(alarm.acktime).toLocaleString('zh-CN') : null
            };
            authorizedAlarms.push(formattedAlarm);
          }
        });
        
        // 只发送有权限且订阅了报警的用户
        if (authorizedAlarms.length > 0 && userAlarmSubscribed.has(userId)) {
          sendToUser(userId, {
            type: 'alarm',
            data: authorizedAlarms
          });
          console.log(`发送报警数据给用户: ${userId} 报警数量: ${authorizedAlarms.length}`);
        } else if (authorizedAlarms.length > 0 && !userAlarmSubscribed.has(userId)) {
          console.log(`用户 ${userId} 未订阅报警，报警数据未发送`);
        }
      }
      
      // 处理历史报警返回
      else if (parsedMessage.method === 'HistoryAlarm' && parsedMessage.data) {
        console.log(`收到历史报警返回，共${parsedMessage.data.length}条`);
        
        const deviceSet = userDeviceCache.get(userId);
        const authorizedAlarms = [];
        
        parsedMessage.data.forEach(alarm => {
          const deviceNo = alarm.name;
          if (deviceSet && deviceSet.has(deviceNo)) {
            // 转换报警格式，适配前端显示
            const formattedAlarm = {
              time: new Date(alarm.newtime).toLocaleString('zh-CN'),
              deviceName: alarm.name,
              type: alarm.type === 'H' ? '高值报警' : 
                    alarm.type === 'L' ? '低值报警' : 
                    alarm.type === 'HH' ? '高高限报警' :
                    alarm.type === 'LL' ? '低低限报警' : alarm.type,
              value: parseFloat(alarm.trigger),
              limit: parseFloat(alarm.limit),
              status: '已处理',
              desc: alarm.desc || alarm.almdesc || '',
              level: alarm.level,
              cancelTime: alarm.canceltime ? new Date(alarm.canceltime).toLocaleString('zh-CN') : null,
              ackTime: alarm.acktime ? new Date(alarm.acktime).toLocaleString('zh-CN') : null,
              operator: alarm.operate || '',
              result: alarm.results || ''
            };
            authorizedAlarms.push(formattedAlarm);
          }
        });
        
        // 只发送有权限的报警数据
        if (authorizedAlarms.length > 0) {
          sendToUser(userId, {
            type: 'history_alarm_result',
            data: authorizedAlarms
          });
          console.log(`发送历史报警数据给用户: ${userId} 报警数量: ${authorizedAlarms.length}`);
        }
      }
    } catch (error) {
      console.error('解析MQTT消息失败:', error);
    }
  });

  // 错误处理
  client.on('error', (error) => {
    console.error(`用户 ${userId} MQTT客户端错误:`, error);
  });

  // 断开连接
  client.on('close', () => {
    console.log(`用户 ${userId} MQTT客户端断开连接`);
  });

  userMqttClients.set(userId, client);
  return client;
}

// 关闭用户MQTT客户端
function closeMQTTClient(userId) {
  if (userMqttClients.has(userId)) {
    const client = userMqttClients.get(userId);
    client.end();
    userMqttClients.delete(userId);
    console.log(`用户 ${userId} MQTT客户端已关闭`);
  }
}

// 初始化全局MQTT客户端
function initGlobalMQTTClient() {
  if (globalMqttClient) {
    console.log('全局MQTT客户端已初始化，无需重复初始化');
    return globalMqttClient;
  }

  const clientId = `${MQTT_CONFIG.clientIdPrefix}global-${Date.now()}`;
  
  globalMqttClient = mqtt.connect({
    host: MQTT_CONFIG.host,
    port: MQTT_CONFIG.port,
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    clientId: clientId,
    connectTimeout: MQTT_CONFIG.connectTimeout,
    reconnectPeriod: MQTT_CONFIG.reconnectPeriod
  });

  globalMqttClient.on('connect', () => {
    console.log('全局MQTT客户端连接成功');
    
    // 只订阅历史报警主题，历史数据由用户MQTT客户端处理
    const topics = [SCADA_TOPICS.HISTORY_ALARM];
    topics.forEach(topic => {
      globalMqttClient.subscribe(topic, (err) => {
        if (err) {
          console.error(`全局订阅主题 ${topic} 失败:`, err);
        } else {
          console.log(`全局成功订阅主题: ${topic}`);
        }
      });
    });
  });

  globalMqttClient.on('message', (topic, message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      console.log(`全局MQTT客户端收到消息: ${topic}`);
      
      // 处理历史报警返回
      if (topic === SCADA_TOPICS.HISTORY_ALARM && parsedMessage.method === 'HistoryAlarm') {
        console.log(`收到历史报警返回，共${parsedMessage.data?.length || 0}条`);
        
        // 发送给所有在线用户
        connectedClients.forEach((client, userId) => {
          if (client.readyState === client.OPEN) {
            sendToUser(userId, {
              type: 'history_alarm_result',
              data: parsedMessage.data || []
            });
          }
        });
      }
      
      // 历史数据由用户MQTT客户端处理，全局客户端不处理历史数据
    } catch (error) {
      console.error('全局MQTT客户端解析消息失败:', error);
    }
  });

  globalMqttClient.on('error', (error) => {
    console.error('全局MQTT客户端错误:', error);
  });

  globalMqttClient.on('close', () => {
    console.log('全局MQTT客户端连接关闭');
  });

  return globalMqttClient;
}

module.exports = {
  initMQTTClient,
  closeMQTTClient,
  initGlobalMQTTClient
};
