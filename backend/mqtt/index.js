const mqtt = require('mqtt');
const WebSocket = require('ws');
const { MQTT_CONFIG, SCADA_TOPICS } = require('../config');
const { userDeviceCache, userMqttClients, userAlarmSubscribed, connectedClients, historyAlarmQueryMap, historyDataQueryMap } = require('../cache');
const { sendToUser } = require('../utils');

// 全局MQTT客户端（用于处理历史报警等全局消息）
let globalMqttClient = null;

// 全局报警MQTT客户端（用于处理实时报警）
let globalAlarmMqttClient = null;

// 报警订阅计数
let alarmSubscribedCount = 0;

/**
 * 格式化时间戳为本地日期字符串
 * @param {number|string} timestamp - 时间戳
 * @returns {string|null} 格式化后的日期字符串
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return null;
  // 如果时间戳是14位，转换为13位
  const ts = String(timestamp).length === 14 ? Math.floor(timestamp / 10) : timestamp;
  return new Date(ts).toLocaleString('zh-CN');
}

/**
 * 处理实时设备数据
 * @param {Object} parsedMessage - 解析后的MQTT消息
 * @param {string} userId - 用户ID
 */
function handleRealtimeData(parsedMessage, userId) {
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

/**
 * 处理历史数据返回
 * @param {Object} parsedMessage - 解析后的MQTT消息
 */
function handleHistoryData(parsedMessage) {
  console.log(`收到历史数据返回，共${parsedMessage.result?.data?.length || 0}条, seq:${parsedMessage.seq}`);
  
  // 【关键修复】优先按seq匹配用户，确保推送给正确的用户
  const targetUserId = historyDataQueryMap.get(parsedMessage.seq);
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
  if (historyDataQueryMap.has(parsedMessage.seq)) {
    historyDataQueryMap.delete(parsedMessage.seq);
    console.log(`已删除历史数据查询映射，seq:${parsedMessage.seq}`);
  }
}

/**
 * 处理实时报警数据
 * @param {Object} parsedMessage - 解析后的MQTT消息
 * @param {string} userId - 用户ID
 */
function handleRealAlarm(parsedMessage, userId) {
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

/**
 * 处理历史报警返回
 * @param {Object} parsedMessage - 解析后的MQTT消息
 */
function handleHistoryAlarm(parsedMessage) {
  console.log(`收到历史报警返回，共${parsedMessage.data.length}条`);
  console.log('历史报警返回数据:', parsedMessage);
  
  // 根据seq查找对应的用户
  const targetUserId = historyAlarmQueryMap.get(parsedMessage.seq);
  console.log(`历史报警查询seq: ${parsedMessage.seq}, 目标用户ID: ${targetUserId}`);
  
  // 直接发送给查询的用户（暂时关闭权限检查）
  const authorizedAlarms = [];
  
  parsedMessage.data.forEach(alarm => {
    console.log('处理单个报警:', alarm);
    // 转换报警格式，适配前端显示
    const formattedAlarm = {
      time: formatTimestamp(alarm.newtime),
      deviceName: alarm.name,
      type: alarm.type || alarm.almdesc || '未知报警',
      value: parseFloat(alarm.trigger) || 0,
      limit: parseFloat(alarm.limit) || 0,
      status: '已处理',
      desc: alarm.desc || alarm.almdesc || '',
      level: alarm.level,
      cancelTime: formatTimestamp(alarm.canceltime),
      ackTime: formatTimestamp(alarm.acktime),
      operator: alarm.operate || '',
      result: alarm.results || ''
    };
    console.log('格式化后的报警:', formattedAlarm);
    authorizedAlarms.push(formattedAlarm);
  });
  
  // 直接发送所有报警数据，跳过权限检查
  if (authorizedAlarms.length > 0) {
    if (targetUserId) {
      sendToUser(targetUserId, {
        type: 'history_alarm_result',
        data: authorizedAlarms
      });
      console.log(`✅ 已向用户 ${targetUserId} 推送历史报警数据，共${authorizedAlarms.length}条`);
    } else {
      console.log(`未找到seq对应的用户，历史报警数据未发送`);
    }
  } else {
    console.log(`没有历史报警数据`);
  }
  
  // 用完删除映射，避免内存泄漏
  if (historyAlarmQueryMap.has(parsedMessage.seq)) {
    historyAlarmQueryMap.delete(parsedMessage.seq);
    console.log(`已删除历史报警查询映射，seq:${parsedMessage.seq}`);
  }
}

/**
 * 处理MQTT消息
 * @param {string} topic - MQTT主题
 * @param {Buffer} message - MQTT消息
 * @param {string} userId - 用户ID
 */
function handleMqttMessage(topic, message, userId) {
  try {
    const parsedMessage = JSON.parse(message.toString());
    console.log(`收到MQTT消息原始结构:`, parsedMessage);
    console.log(`收到MQTT消息: ${topic} 包含 ${parsedMessage.RTValue ? parsedMessage.RTValue.length : 0} 个设备数据`);

    // 处理实时设备数据
    if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
      handleRealtimeData(parsedMessage, userId);
    }
    
    // 处理历史数据返回（hisdatatest主题）
    else if (topic === 'hisdatatest' || (parsedMessage.method === 'HistoryData' && parsedMessage.result && parsedMessage.result.data)) {
      handleHistoryData(parsedMessage);
    }
    
    // 处理报警数据
    else if (parsedMessage.method === 'RealAlarm' && Array.isArray(parsedMessage.alarms)) {
      handleRealAlarm(parsedMessage, userId);
    }
    
    // 处理历史报警返回
    else if (parsedMessage.method === 'HistoryAlarm' && parsedMessage.data) {
      handleHistoryAlarm(parsedMessage);
    }
  } catch (error) {
    console.error('解析MQTT消息失败:', error);
  }
}

/**
 * 初始化用户MQTT客户端
 * @param {string} userId - 用户ID
 * @param {Array} topics - 订阅的主题列表
 * @returns {Object} MQTT客户端实例
 */
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
    handleMqttMessage(topic, message, userId);
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

/**
 * 关闭用户MQTT客户端
 * @param {string} userId - 用户ID
 */
function closeMQTTClient(userId) {
  if (userMqttClients.has(userId)) {
    const client = userMqttClients.get(userId);
    client.end();
    userMqttClients.delete(userId);
    console.log(`用户 ${userId} MQTT客户端已关闭`);
  }
}

/**
 * 处理全局MQTT消息
 * @param {string} topic - MQTT主题
 * @param {Buffer} message - MQTT消息
 */
function handleGlobalMqttMessage(topic, message) {
  try {
    const parsedMessage = JSON.parse(message.toString());
    console.log(`全局MQTT客户端收到消息: ${topic}`);
    
    // 处理历史报警返回
    if (topic === SCADA_TOPICS.HISTORY_ALARM && parsedMessage.method === 'HistoryAlarm') {
      console.log(`收到历史报警返回，共${parsedMessage.data?.length || 0}条`);
      console.log('历史报警返回数据:', parsedMessage);
      
      // 根据seq查找对应的用户
      const targetUserId = historyAlarmQueryMap.get(parsedMessage.seq);
      console.log(`历史报警查询seq: ${parsedMessage.seq}, 目标用户ID: ${targetUserId}`);
      
      // 直接发送给查询的用户（暂时关闭权限检查）
      const authorizedAlarms = [];
      
      if (parsedMessage.data && Array.isArray(parsedMessage.data)) {
        parsedMessage.data.forEach(alarm => {
          console.log('处理单个报警:', alarm);
          // 转换报警格式，适配前端显示
          const formattedAlarm = {
            time: formatTimestamp(alarm.newtime),
            deviceName: alarm.name,
            type: alarm.type || alarm.almdesc || '未知报警',
            value: parseFloat(alarm.trigger) || 0,
            limit: parseFloat(alarm.limit) || 0,
            status: '已处理',
            desc: alarm.desc || alarm.almdesc || '',
            level: alarm.level,
            cancelTime: formatTimestamp(alarm.canceltime),
            ackTime: formatTimestamp(alarm.acktime),
            operator: alarm.operate || '',
            result: alarm.results || ''
          };
          console.log('格式化后的报警:', formattedAlarm);
          authorizedAlarms.push(formattedAlarm);
        });
      }
      
      // 直接发送所有报警数据，跳过权限检查
      if (authorizedAlarms.length > 0) {
        if (targetUserId) {
          sendToUser(targetUserId, {
            type: 'history_alarm_result',
            data: authorizedAlarms
          });
          console.log(`✅ 已向用户 ${targetUserId} 推送历史报警数据，共${authorizedAlarms.length}条`);
        } else {
          console.log(`未找到seq对应的用户，历史报警数据未发送`);
        }
      } else {
        console.log(`没有历史报警数据`);
      }
      
      // 用完删除映射，避免内存泄漏
      if (historyAlarmQueryMap.has(parsedMessage.seq)) {
        historyAlarmQueryMap.delete(parsedMessage.seq);
        console.log(`已删除历史报警查询映射，seq:${parsedMessage.seq}`);
      }
    }
    
    // 历史数据由用户MQTT客户端处理，全局客户端不处理历史数据
  } catch (error) {
    console.error('全局MQTT客户端解析消息失败:', error);
  }
}

/**
 * 初始化全局MQTT客户端
 * @returns {Object} 全局MQTT客户端实例
 */
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
    handleGlobalMqttMessage(topic, message);
  });

  globalMqttClient.on('error', (error) => {
    console.error('全局MQTT客户端错误:', error);
  });

  globalMqttClient.on('close', () => {
    console.log('全局MQTT客户端连接关闭');
  });

  return globalMqttClient;
}

/**
 * 处理全局报警MQTT消息
 * @param {string} topic - MQTT主题
 * @param {Buffer} message - MQTT消息
 */
function handleGlobalAlarmMqttMessage(topic, message) {
  if (topic === 'backend/real/alarm') {
    try {
      const alarmData = JSON.parse(message.toString());
      console.log('收到SCADA报警数据:', alarmData);
      
      // 检查是否是实时报警数据
      if (alarmData.method === 'RealAlarm' && Array.isArray(alarmData.alarms)) {
        // 遍历所有报警
        alarmData.alarms.forEach(alarm => {
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
          
          // 遍历所有在线用户，按权限和订阅状态推送报警
          connectedClients.forEach((ws, userId) => {
            // 只推送给订阅了报警且有设备权限的用户
            if (userAlarmSubscribed.has(userId) && userAlarmSubscribed.get(userId)) {
              const userDevices = userDeviceCache.get(userId);
              if (userDevices && userDevices.has(alarm.name)) {
                // 有权限且已订阅，推送报警给用户
                if (ws.readyState === ws.OPEN) {
                  sendToUser(userId, {
                    type: 'alarm',
                    data: formattedAlarm
                  });
                }
              }
            }
          });
        });
      }
    } catch (error) {
      console.error('解析SCADA报警消息失败:', error);
    }
  }
}

/**
 * 初始化全局报警MQTT客户端
 * @returns {Object} 全局报警MQTT客户端实例
 */
function initGlobalAlarmMqtt() {
  const mqttHost = MQTT_CONFIG.host;
  const mqttPort = MQTT_CONFIG.port;
  const mqttUrl = `mqtt://${mqttHost}:${mqttPort}`;
  
  console.log('初始化全局MQTT报警客户端，连接到:', mqttUrl);
  
  globalAlarmMqttClient = mqtt.connect({
    host: MQTT_CONFIG.host,
    port: MQTT_CONFIG.port,
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    clientId: `alarm-subscriber-${Date.now()}`,
    clean: true,
    connectTimeout: MQTT_CONFIG.connectTimeout,
    reconnectPeriod: MQTT_CONFIG.reconnectPeriod
  });
  
  globalAlarmMqttClient.on('connect', () => {
    console.log('全局MQTT报警客户端连接成功');
    
    // 订阅实时报警主题
    const RECEIVE_ALARM_TOPIC = 'backend/real/alarm';
    globalAlarmMqttClient.subscribe(RECEIVE_ALARM_TOPIC, (err) => {
      if (err) {
        console.error('订阅实时报警主题失败:', err);
      } else {
        console.log('成功订阅实时报警主题:', RECEIVE_ALARM_TOPIC);
      }
    });
  });
  
  globalAlarmMqttClient.on('message', (topic, message) => {
    handleGlobalAlarmMqttMessage(topic, message);
  });
  
  globalAlarmMqttClient.on('error', (error) => {
    console.error('全局MQTT报警客户端错误:', error);
  });
  
  globalAlarmMqttClient.on('close', () => {
    console.log('全局MQTT报警客户端断开连接，尝试重连...');
  });
  
  return globalAlarmMqttClient;
}

module.exports = {
  initMQTTClient,
  closeMQTTClient,
  initGlobalMQTTClient,
  initGlobalAlarmMqtt,
  getGlobalAlarmMqttClient: () => globalAlarmMqttClient
};
