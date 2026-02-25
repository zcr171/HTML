// 全局错误捕获
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

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const mqtt = require('mqtt');
const http = require('http');
const WebSocket = require('ws');

// 创建Express应用和HTTP服务器
const app = express();
const server = http.createServer(app);

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 存储所有连接的WebSocket客户端
const connectedClients = new Map();

// 内存缓存：用户ID → 设备位号Set
const userDeviceCache = new Map();

// 内存缓存：用户ID → MQTT客户端
const userMqttClients = new Map();

// 内存缓存：用户ID → 用户信息（用于缓存刷新）
const userInfoCache = new Map();

// 单点登录缓存：用户ID → 当前有效token
const userValidTokenCache = new Map();

// 用户报警订阅状态：用户ID → 是否订阅了报警
const userAlarmSubscribed = new Map();

// 当前订阅报警的用户数量
let alarmSubscribedCount = 0;

// 保存最近发起历史报警查询的用户ID（解决SCADA固定返回seq=0的问题）
let lastHistoryAlarmUserId = null;

// 历史查询映射表：key=seq(13位时间戳), value=userId，解决多用户并发串数据
const historyAlarmQueryMap = new Map();

// 浙大中控SCADA报警配置（放最前面，避免函数引用时未定义）
const SCADA_ALARM_TOPIC = 'SupconScadaRealAlarm'; // SCADA报警服务主题
const RECEIVE_ALARM_TOPIC = 'backend/real/alarm'; // 我们自己接收报警的主题（实时报警已经正常工作，保持不变）
const SCADA_HIS_ALARM_TOPIC = 'SupconScadaHisAlarm'; // SCADA历史报警服务主题
const RECEIVE_HIS_ALARM_TOPIC = 'HisAlarm'; // 我们自己接收历史报警的主题（严格按照协议）

// 全局变量存储报警数据
let alarmData = { alarms: [] };

// 全局MQTT报警客户端（用于订阅专门的报警主题）
let globalAlarmMqttClient = null;

// 加载环境变量
dotenv.config();

const port = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 厂区配置：位掩码映射
const FACTORY_CONFIG = {
  RD: { bit: 1, value: 2, topic: 'rdvalue' },      // 热电域
  QH: { bit: 2, value: 4, topic: 'qhvalue' },      // 气化域
  JH: { bit: 3, value: 8, topic: 'jhvalue' },      // 净化成品域
  HS: { bit: 4, value: 16, topic: 'hsvalue' },     // 回收域
  DW: { bit: 5, value: 32, topic: 'dwvalue' }      // 人员定位系统
};

// 超级管理员标识
const SUPER_ADMIN = 99;

// 处理WebSocket连接
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
    
    // 监听WebSocket消息，处理前端的MQTT发布请求
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
                    lastHistoryAlarmUserId = userId;
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
                }
              

              
              // 发布消息到MQTT服务器
              mqttClient.publish(data.topic, JSON.stringify(data.payload), (err) => {
                if (err) {
                  console.error(`发布MQTT消息失败 主题:${data.topic}`, err);
                }
              });
            }
          }
          // 处理历史报警查询请求
          else if (data.type === 'query_history_alarm' && data.data) {
            console.log(`用户 ${userId} 请求查询历史报警`);
            // 记录当前查询用户
            lastHistoryAlarmUserId = userId;
            
            // 把查询请求转发到SCADA历史报警主题（直接用主MQTT客户端发送，和实时数据一样）
            if (mqttClient && mqttClient.connected) {
              const queryData = {...data.data};
              // SCADA要求seq=0，固定用0
              queryData.seq = 0;
              
              mqttClient.publish(SCADA_HIS_ALARM_TOPIC, JSON.stringify(queryData), (err) => {
                if (err) {
                  console.error('发送历史报警查询请求失败:', err);
                } else {
                  console.log('已向SCADA发送历史报警查询请求');
                }
              });
            }
          }
          // 处理报警订阅/取消订阅请求
          else if (data.type === 'alarm_subscribe' && data.state !== undefined) {
            const userIdNum = parseInt(userId);
            const isSubscribe = data.state === 0;
            console.log(`用户 ${userId} 请求${isSubscribe ? '订阅' : '取消订阅'}实时报警`);
            
            // 更新用户订阅状态
            if (isSubscribe) {
              userAlarmSubscribed.set(userIdNum, true);
              alarmSubscribedCount++;
              // 如果是第一个订阅的用户，向SCADA发送订阅请求
              if (alarmSubscribedCount === 1) {
                if (globalAlarmMqttClient && globalAlarmMqttClient.connected) {
                  const subscribeMsg = {
                    method: "RealAlarm",
                    state: 0,
                    topic: RECEIVE_ALARM_TOPIC
                  };
                  globalAlarmMqttClient.publish(SCADA_ALARM_TOPIC, JSON.stringify(subscribeMsg), (err) => {
                    if (err) {
                      console.error('发送订阅报警请求失败:', err);
                    } else {
                      console.log('已向SCADA发送订阅实时报警请求');
                    }
                  });
                }
              }
            } else {
              if (userAlarmSubscribed.has(userIdNum)) {
                userAlarmSubscribed.delete(userIdNum);
                alarmSubscribedCount--;
                // 如果没有用户订阅了，向SCADA发送取消订阅请求
                if (alarmSubscribedCount === 0) {
                  if (globalAlarmMqttClient && globalAlarmMqttClient.connected) {
                    const unsubscribeMsg = {
                      method: "RealAlarm",
                      state: 1,
                      topic: RECEIVE_ALARM_TOPIC
                    };
                    globalAlarmMqttClient.publish(SCADA_ALARM_TOPIC, JSON.stringify(unsubscribeMsg), (err) => {
                      if (err) {
                        console.error('发送取消订阅报警请求失败:', err);
                      } else {
                        console.log('已向SCADA发送取消订阅实时报警请求');
                      }
                    });
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('解析WebSocket消息失败:', error);
        }
      });
    
    // 如果用户还没有MQTT客户端，自动初始化
    if (!userMqttClients.has(userId)) {
      console.log(`用户 ${userId} 尚未初始化MQTT，自动初始化中...`);
      try {
        // 如果用户信息不在缓存，从数据库查询
        let userInfo = null;
        if (userInfoCache.has(userId)) {
          userInfo = userInfoCache.get(userId);
        } else {
          // 从数据库查询用户信息（使用async/await适配promise版mysql2）
          const [results] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
          if (results.length > 0) {
            userInfo = results[0];
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
            const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
            await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
            console.log(`用户 ${userId} 设备权限缓存完成`);
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
            const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
            await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
            console.log(`用户 ${userId} 设备权限缓存完成`);
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
  
  // 处理客户端断开连接
  ws.on('close', () => {
    console.log('WebSocket客户端断开连接');
    if (userId) {
      connectedClients.delete(userId);
    }
  });
  
  // 处理客户端错误
  ws.on('error', (error) => {
    console.error('WebSocket客户端错误:', error);
    if (userId) {
      connectedClients.delete(userId);
    }
  });
});

// 向指定用户发送WebSocket消息
function sendToUser(userId, message) {
  const client = connectedClients.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
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

// 数据库连接配置
const dbConfig = {
  host: process.env.DB_HOST || '192.168.10.180',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
  database: process.env.DB_NAME || 'scada_web',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建数据库连接池
let pool;
try {
  pool = mysql.createPool(dbConfig);
  console.log('数据库连接池创建成功');
} catch (error) {
  console.error('数据库连接池创建失败:', error);
  process.exit(1);
}

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('数据库连接成功');
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    return false;
  }
}

// 【核心】二进制位掩码解析函数（严格按照用户规范）
function parseFactoryLevel(factoryLevel) {
  const areaMap = {
    RD: 2,
    QH: 4,
    JH: 8,
    HS: 16,
    DW: 32
  };
  const allowedAreas = [];
  // 仅对非99的数值做&运算
  if (factoryLevel !== SUPER_ADMIN) {
    for (const [areaName, bitValue] of Object.entries(areaMap)) {
      // 二进制&运算：只有结果≠0，说明有该厂区权限
      if ((factoryLevel & bitValue) !== 0) {
        allowedAreas.push(bitValue);
      }
    }
  } else {
    // 超级管理员返回所有厂区
    allowedAreas.push(...Object.values(areaMap));
  }
  return allowedAreas;
}

// 【核心】厂区列表 → MQTT Topic列表映射函数
function factoriesToTopics(factories) {
  if (factories.length === 0) {
    // 空工厂列表，返回所有Topic
    return Object.values(FACTORY_CONFIG).map(config => config.topic);
  }
  
  const topics = [];
  for (const factoryValue of factories) {
    // 查找对应的厂区配置
    for (const [areaName, config] of Object.entries(FACTORY_CONFIG)) {
      if (config.value === factoryValue) {
        topics.push(config.topic);
        break;
      }
    }
  }
  return topics;
}

// 【核心】批量查询用户有权限的设备（严格按照用户规范）
async function getUserDevices(userId, factories, areaLevel, isSuperAdmin) {
  try {
    let devices = [];
    let query = '';
    let params = [];
    
    if (isSuperAdmin) {
      // 超级管理员：无过滤，查所有设备
      console.log('超级管理员查询所有设备');
      query = `SELECT * FROM device_data`;
    } else {
      // 普通用户：带字段归属、权限过滤
      console.log('普通用户查询设备，厂区列表:', factories, 'areaLevel:', areaLevel);
      
      if (factories.length === 0) {
        console.log('用户无厂区权限，返回空设备列表');
        return {
          deviceSet: new Set(),
          deviceList: []
        };
      }
      
      // 构建厂区条件
      const factoryPlaceholders = factories.map(() => '?').join(',');
      query = `SELECT * FROM device_data 
               WHERE factory IN (${factoryPlaceholders}) 
               AND (level IS NULL OR level <= ?)`;
      
      // 构建查询参数
      params = [...factories, areaLevel];
    }
    
    // 执行查询
    const [results] = await pool.execute(query, params);
    devices = results;
    
    console.log('设备查询结果数量:', devices.length);
    
    // 构建设备位号Set（用于O(1)权限判断）
    const deviceSet = new Set();
    const deviceList = [];
    
    for (const device of devices) {
      deviceSet.add(device.device_no);
      deviceList.push(device); // 返回完整设备信息
    }
    
    // 缓存到内存（Key=用户ID，Value=设备位号Set）
    userDeviceCache.set(userId, deviceSet);
    console.log('设备缓存已更新，设备数量:', deviceSet.size);
    
    return {
      deviceSet,
      deviceList
    };
  } catch (error) {
    console.error('批量查询设备失败:', error);
    throw error;
  }
}

// 【核心】MQTT初始化函数
function initMQTTClient(userId, topics) {
  console.log('初始化MQTT客户端:', { userId, topics });
  
  // 尝试连接MQTT服务器（支持主备切换）
  function connectToMQTTServer(config, isBackup = false) {
    console.log(`${isBackup ? '尝试连接到备用MQTT服务器' : '尝试连接到MQTT服务器'}:`, config.host);
    let mqttClient;
    try {
      mqttClient = mqtt.connect(config);
    } catch (error) {
      console.error(`${isBackup ? '备用MQTT连接失败' : 'MQTT连接失败'}:`, error);
      return null;
    }

    mqttClient.on('connect', function(connack) {
      console.log(`${isBackup ? '备用MQTT连接成功' : 'MQTT连接成功'}:`, connack);

      // 订阅Topic列表（仅订阅有权限的纯Topic，无通配符） + 历史数据返回主题
      topics.push('hisdatatest'); // 添加历史数据返回主题订阅
      console.log('订阅MQTT Topic:', topics);
      topics.forEach(topic => {
        mqttClient.subscribe(topic, function(err) {
          if (!err) {
            console.log('订阅主题成功:', topic);
          } else {
            console.error('订阅主题失败:', topic, err);
          }
        });
      });
    });

    mqttClient.on('message', function(topic, message) {
      try {
        const parsedMessage = JSON.parse(message.toString());
        
        // 检查消息格式：实时数据
        if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
          // 【核心】权限判断：对每个设备单独检查权限
          const deviceSet = userDeviceCache.get(userId);
          const authorizedDevices = [];
          
          parsedMessage.RTValue.forEach(device => {
            const deviceNo = device.name; // MQTT消息中的设备标识符字段是name
            if (deviceSet && deviceSet.has(deviceNo)) {
              authorizedDevices.push(device);
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
            console.log('发送实时数据给用户:', userId, '设备数量:', authorizedDevices.length);
          }
        }
        // 处理历史数据返回（hisdatatest主题）
        else if (topic === 'hisdatatest' || (parsedMessage.method === 'HistoryData' && parsedMessage.result && parsedMessage.result.data)) {
          console.log(`收到历史数据返回，共${parsedMessage.result?.data?.length || 0}条, seq:${parsedMessage.seq}`);
          
          // 优先按seq匹配用户，确保推送给正确的用户
          const targetUserId = historyAlarmQueryMap.get(parsedMessage.seq) || lastHistoryAlarmUserId;
          const userWs = targetUserId ? connectedClients.get(targetUserId.toString()) : null;
          
          if (userWs && userWs.readyState === WebSocket.OPEN) {
            userWs.send(JSON.stringify({
              type: 'history_data',
              data: parsedMessage
            }));
            console.log(`✅ 已向用户 ${targetUserId} 推送历史数据，共${parsedMessage.result?.data?.length || 0}条`);
          } else {
            console.log(`用户 ${targetUserId} 没有在线的WebSocket连接，历史数据消息未发送`);
          }
          
          // 用完删除映射
          if (historyAlarmQueryMap.has(parsedMessage.seq)) {
            historyAlarmQueryMap.delete(parsedMessage.seq);
          }
        }
        else {
          console.error('MQTT消息格式错误，无法识别消息类型:', parsedMessage);
        }
      } catch (e) {
        console.error('解析MQTT消息失败:', e);
      }
    });

    mqttClient.on('error', function(err) {
      console.error('MQTT连接错误:', err);
      // 错误处理：MQTT连接错误不应导致服务器崩溃
    });

    mqttClient.on('offline', function() {
      console.log('MQTT连接断开');
    });

    mqttClient.on('close', function() {
      console.log('MQTT连接关闭');
    });

    return mqttClient;
  }

  // 主MQTT服务器配置
  const primaryConfig = {
    host: process.env.MQTT_HOST || '192.168.10.180',
    port: process.env.MQTT_PORT || 1883,
    username: process.env.MQTT_USERNAME || 'web_admin_9',
    password: process.env.MQTT_PASSWORD || 'web_admin_9',
    clientId: `user_${userId}_${Date.now()}`,
    clean: true,
    connectTimeout: 5000, // 缩短超时时间
    reconnectPeriod: 3000,
    keepalive: 30,
    resubscribe: true
  };

  // 备用MQTT服务器配置
  const backupConfig = {
    host: process.env.MQTT_BACKUP_HOST || '192.168.10.234',
    port: process.env.MQTT_BACKUP_PORT || 1883,
    username: process.env.MQTT_BACKUP_USERNAME || 'web_admin_9',
    password: process.env.MQTT_BACKUP_PASSWORD || 'web_admin_9',
    clientId: `user_${userId}_${Date.now()}_backup`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000,
    keepalive: 30,
    resubscribe: true
  };

  try {
    // 先尝试连接主服务器
    let mqttClient = connectToMQTTServer(primaryConfig);
    
    // 如果主服务器连接失败，尝试备用服务器
    if (!mqttClient) {
      console.log('主MQTT服务器连接失败，尝试备用服务器');
      mqttClient = connectToMQTTServer(backupConfig, true);
    }

    // 存储用户MQTT客户端
    if (mqttClient) {
      userMqttClients.set(userId, mqttClient);
    } else {
      console.warn('所有MQTT服务器连接失败，将在后台继续尝试重连');
    }
    
    return mqttClient;
  } catch (error) {
    console.error('MQTT客户端初始化失败:', error);
    return null;
  }
}

// JWT验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ code: 401, msg: '未提供认证令牌' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key', (err, user) => {
    if (err) {
      return res.status(403).json({ code: 403, msg: '认证令牌无效' });
    }

    // 单点登录校验：检查token是否是当前用户的有效token
    const validToken = userValidTokenCache.get(user.userId);
    if (!validToken || validToken !== token) {
      return res.status(401).json({ code: 401, msg: '账号已在其他地方登录，请重新登录' });
    }

    req.user = user;
    next();
  });
};

// 根路径
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 健康检查接口
app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection();

  res.json({ 
    status: 'ok', 
    database: dbConnected ? 'main' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 登录接口 - 支持 /api/login 路径
app.post('/api/login', async (req, res) => {
  await handleLogin(req, res);
});

// 登录接口 - 支持 /api/auth/login 路径（兼容前端）
app.post('/api/auth/login', async (req, res) => {
  await handleLogin(req, res);
});

// 登录处理函数
async function handleLogin(req, res) {
  try {

    const { username, password } = req.body;
    console.log('登录请求:', { username });
    
    // 验证参数
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 从数据库查询用户
    const [userResults] = await pool.execute(
      'SELECT id, username, password, realname, factory_level, area_level, enabled FROM web_user WHERE username = ?',
      [username]
    );
    
    if (userResults.length === 0) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    const user = userResults[0];
    
    // 检查账号是否启用
    if (user.enabled !== 1) {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }
    
    // 验证密码
    let passwordMatch;
    
    try {
      // 尝试使用bcrypt验证（适用于加密密码）
      passwordMatch = await bcrypt.compare(password, user.password);
      
      // 如果bcrypt验证失败，尝试直接字符串比较（适用于明文密码）
      if (!passwordMatch) {
        passwordMatch = (password === user.password);
      }
    } catch (error) {
      // 如果bcrypt验证抛出异常，尝试直接字符串比较（适用于明文密码）
      passwordMatch = (password === user.password);
    }
    
    if (!passwordMatch) {
      console.log('密码验证失败:', { username, passwordMatch });
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    console.log('密码验证成功:', { username });

    
    // 【核心】位掩码解析厂区列表
    const factories = parseFactoryLevel(user.factory_level);
    console.log('用户权限解析:', { userId: user.id, factoryLevel: user.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = user.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 【核心】批量查询用户有权限的设备
    const { deviceList } = await getUserDevices(user.id, factories, user.area_level, isSuperAdmin);
    console.log('用户设备权限:', { userId: user.id, deviceCount: deviceList.length });
    
    // 【核心】厂区列表 → MQTT Topic列表映射
    const mqttTopics = factoriesToTopics(factories);
    console.log('用户MQTT订阅:', { userId: user.id, topics: mqttTopics });
    
    // 【核心】初始化MQTT客户端
    initMQTTClient(user.id, mqttTopics);
    console.log('MQTT客户端初始化完成');

    
    // 单点登录：旧token自动失效，旧的登录会在下次请求时自动下线，不影响新连接
    
    // 缓存用户信息（用于后续缓存刷新）
    userInfoCache.set(user.id, {
      factory_level: user.factory_level,
      area_level: user.area_level
    });
    
    // 生成JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.area_level === SUPER_ADMIN ? 'admin' : 'user'
      },
      process.env.JWT_SECRET || 'default_secret_key',
      {
        expiresIn: '24h'
      }
    );

    // 单点登录：存储当前用户的有效token，旧token自动失效
    userValidTokenCache.set(user.id, token);
    
    // 返回成功响应（兼容前端格式）
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        realname: user.realname,
        role: user.area_level === SUPER_ADMIN ? 'admin' : 'user',
        factory_level: user.factory_level
      },
      data: {
        allowedDevices: deviceList
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
  }
};

// 历史数据查询接口
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const { userId, startTime, endTime } = req.query;
    console.log('历史数据查询请求:', { userId, startTime, endTime });
    
    // 验证参数
    if (!userId || !startTime || !endTime) {
      return res.status(400).json({ code: 400, msg: '参数不能为空' });
    }
    
    // 【核心】从内存缓存获取设备位号Set（禁止重复查询MySQL）
    const deviceSet = userDeviceCache.get(userId);
    if (!deviceSet) {
      return res.status(401).json({ code: 401, msg: '用户未登录或缓存已过期' });
    }
    
    const deviceNos = Array.from(deviceSet);
    if (deviceNos.length === 0) {
      return res.json({ code: 0, msg: 'success', data: [] });
    }
    
    // 构建设备位号IN条件
    const devicePlaceholders = deviceNos.map(() => '?').join(',');
    
    // 这里应该是查询历史数据的逻辑
    // 由于历史数据存储方式未知，这里仅返回示例结构
    // 实际实现时需要根据具体的历史数据存储方式调整
    
    res.json({
      code: 0,
      msg: 'success',
      data: {
        devices: deviceNos,
        startTime: startTime,
        endTime: endTime,
        message: '历史数据查询接口已实现，实际数据需要根据存储方式调整'
      }
    });
    
  } catch (error) {
    console.error('历史数据查询错误:', error);
    res.status(500).json({ code: 500, msg: '查询失败，请稍后重试' });
  }
});

// 退出登录接口
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    console.log('退出登录请求:', { userId });
    
    // 清理WebSocket连接
    connectedClients.delete(userId);
    
    // 清理MQTT客户端
    const mqttClient = userMqttClients.get(userId);
    if (mqttClient) {
      mqttClient.end();
      userMqttClients.delete(userId);
    }
    
    // 清理设备缓存
    userDeviceCache.delete(userId);
    // 清理用户信息缓存
    userInfoCache.delete(userId);
    
    res.json({ code: 0, msg: '退出成功' });
    
  } catch (error) {
    console.error('退出登录错误:', error);
    res.status(500).json({ code: 500, msg: '退出失败，请稍后重试' });
  }
});

// 获取设备列表接口
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    console.log('获取设备列表请求');
    const { userId } = req.user;
    
    // 从用户信息缓存中获取用户权限信息
    const userInfo = userInfoCache.get(userId);
    if (!userInfo) {
      console.error('用户信息缓存不存在');
      return res.status(401).json({ success: false, message: '用户未登录或缓存已过期' });
    }
    
    // 解析用户厂区权限
    const factories = parseFactoryLevel(userInfo.factory_level);
    console.log('用户权限解析:', { userId, factoryLevel: userInfo.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 批量查询用户有权限的设备
    const { deviceList } = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    console.log('用户设备权限:', { userId, deviceCount: deviceList.length });
    
    res.json({
      success: true,
      data: deviceList
    });
    
  } catch (error) {
    console.error('获取设备列表错误:', error);
    res.status(500).json({ success: false, message: '获取设备列表失败，请稍后重试' });
  }
});

// ====================== 管理员接口 ======================
// 管理员权限校验中间件
const adminAuth = async (req, res, next) => {
  try {
    const { userId } = req.user;
    const userInfo = userInfoCache.get(userId);
    
    if (!userInfo || userInfo.factory_level !== SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: '无管理员权限' });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: '权限校验失败' });
  }
};

// 管理员：获取所有用户列表
app.get('/api/admin/users', authenticateToken, adminAuth, async (req, res) => {
  try {
    const [users] = await pool.execute('SELECT id, username, realname, factory_level, area_level, enabled, create_time FROM web_user ORDER BY id');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// 管理员：创建新用户
app.post('/api/admin/users', authenticateToken, adminAuth, async (req, res) => {
  try {
    const { username, password, realname, factory_level, area_level, enabled } = req.body;
    
    // 验证参数
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 检查用户名是否已存在
    const [existingUsers] = await pool.execute('SELECT id FROM web_user WHERE username = ?', [username]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    
    // 加密密码（如果长度不是60位bcrypt密文的话）
    let hashedPassword = password;
    if (password.length !== 60 || !password.startsWith('$2b$')) {
      hashedPassword = await bcrypt.hash(password, 10);
    }
    
    // 插入用户
    const [result] = await pool.execute(
      'INSERT INTO web_user (username, password, realname, factory_level, area_level, enabled, create_time) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [username, hashedPassword, realname || '', factory_level || 0, area_level || 1, enabled || 1]
    );
    
    res.json({ success: true, data: { id: result.insertId }, message: '用户创建成功' });
  } catch (error) {
    console.error('创建用户失败:', error);
    res.status(500).json({ success: false, message: '创建用户失败: ' + error.message });
  }
});

// 管理员：更新用户信息
app.put('/api/admin/users/:id', authenticateToken, adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const { realname, factory_level, area_level, enabled } = req.body;
    
    // 更新用户信息
    await pool.execute(
      'UPDATE web_user SET realname = ?, factory_level = ?, area_level = ?, enabled = ? WHERE id = ?',
      [realname || '', factory_level || 0, area_level || 1, enabled || 0, userId]
    );
    
    // 清除用户缓存
    userInfoCache.delete(userId);
    userDeviceCache.delete(userId);
    
    // 如果用户有MQTT连接，断开重连以更新权限
    if (userMqttClients.has(userId)) {
      userMqttClients.get(userId).end();
      userMqttClients.delete(userId);
    }
    
    res.json({ success: true, message: '用户信息更新成功' });
  } catch (error) {
    console.error('更新用户失败:', error);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// 管理员：重置用户密码
app.put('/api/admin/users/:id/reset-password', authenticateToken, adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const { newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ success: false, message: '新密码不能为空' });
    }
    
    // 加密密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // 更新密码
    await pool.execute('UPDATE web_user SET password = ? WHERE id = ?', [hashedPassword, userId]);
    
    res.json({ success: true, message: '密码重置成功' });
  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(500).json({ success: false, message: '重置密码失败' });
  }
});

// 管理员：删除用户
app.delete('/api/admin/users/:id', authenticateToken, adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // 不能删除自己
    if (userId == req.user.userId) {
      return res.status(400).json({ success: false, message: '不能删除当前登录用户' });
    }
    
    // 删除用户
    await pool.execute('DELETE FROM web_user WHERE id = ?', [userId]);
    
    // 清除用户缓存
    userInfoCache.delete(userId);
    userDeviceCache.delete(userId);
    
    // 断开用户连接
    if (connectedClients.has(userId)) {
      connectedClients.get(userId).close();
      connectedClients.delete(userId);
    }
    
    if (userMqttClients.has(userId)) {
      userMqttClients.get(userId).end();
      userMqttClients.delete(userId);
    }
    
    res.json({ success: true, message: '用户删除成功' });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// 法律法规搜索接口
app.post('/api/laws/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    let query = `
      SELECT law_title, law_type, issuing_no, implement_date, file_path, file_name 
      FROM laws_docs 
      WHERE status = 1
    `;
    let params = [];
    
    if (keyword) {
      query += ` AND (law_title LIKE ? OR issuing_no LIKE ?)`;
      params = [`%${keyword}%`, `%${keyword}%`];
    }
    
    // 执行查询
    const [rows] = await pool.execute(query, params);
    
    // 返回结果
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('搜索法规失败:', error);
    res.json({ success: false, message: '搜索失败，请稍后重试' });
  }
});

// 标准规范搜索接口
app.post('/api/standards/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.body;
    
    let query = `
      SELECT doc_title, doc_type, issuing_no, release_date, file_path, file_name 
      FROM standard_docs 
      WHERE status = 1
    `;
    let params = [];
    
    if (keyword) {
      // 使用LOWER()函数实现大小写不敏感的搜索
      query += ` AND (LOWER(doc_title) LIKE LOWER(?) OR LOWER(issuing_no) LIKE LOWER(?))`;
      params = [`%${keyword}%`, `%${keyword}%`];
    }
    
    // 执行查询
    const [rows] = await pool.execute(query, params);
    
    // 返回结果
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('搜索标准规范失败:', error);
    res.json({ success: false, message: '搜索失败，请稍后重试' });
  }
});

// 管理员：获取所有设备列表
app.get('/api/admin/devices', authenticateToken, adminAuth, async (req, res) => {
  try {
    const [devices] = await pool.execute('SELECT * FROM device_data ORDER BY id');
    res.json({ success: true, data: devices });
  } catch (error) {
    console.error('获取设备列表失败:', error);
    res.status(500).json({ success: false, message: '获取设备列表失败' });
  }
});

// 管理员：更新设备信息
app.put('/api/admin/devices/:id', authenticateToken, adminAuth, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { device_no, device_name, factory, unit, alarm_high, alarm_low, description } = req.body;
    
    await pool.execute(
      'UPDATE device_data SET device_no = ?, device_name = ?, factory = ?, unit = ?, alarm_high = ?, alarm_low = ?, description = ? WHERE id = ?',
      [device_no, device_name || '', factory || 0, unit || '', alarm_high || null, alarm_low || null, description || '', deviceId]
    );
    
    // 清除所有用户的设备缓存，触发重新加载
    userDeviceCache.clear();
    
    res.json({ success: true, message: '设备信息更新成功' });
  } catch (error) {
    console.error('更新设备失败:', error);
    res.status(500).json({ success: false, message: '更新设备失败' });
  }
});

// 刷新用户设备缓存
async function refreshUserDeviceCache(userId) {
  try {
    console.log('开始刷新用户设备缓存:', { userId });
    
    // 从用户信息缓存中获取用户权限信息
    const userInfo = userInfoCache.get(userId);
    if (!userInfo) {
      console.log('用户信息不存在，跳过缓存刷新:', { userId });
      return;
    }
    
    // 解析用户厂区权限
    const factories = parseFactoryLevel(userInfo.factory_level);
    console.log('用户权限解析:', { userId, factoryLevel: userInfo.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 重新查询用户有权限的设备
    const { deviceSet } = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    console.log('缓存刷新完成，设备数量:', { userId, deviceCount: deviceSet.size });
    
  } catch (error) {
    console.error('刷新用户设备缓存失败:', error);
  }
}

// 刷新所有用户设备缓存
async function refreshAllDeviceCache() {
  try {
    console.log('开始刷新所有用户设备缓存，当前登录用户数:', userInfoCache.size);
    
    // 遍历所有已登录用户
    for (const userId of userInfoCache.keys()) {
      await refreshUserDeviceCache(userId);
    }
    
    console.log('所有用户设备缓存刷新完成');
  } catch (error) {
    console.error('刷新所有用户设备缓存失败:', error);
  }
}

// 初始化全局MQTT报警订阅
function initGlobalAlarmMqtt() {
  const mqttHost = process.env.MQTT_HOST || '192.168.10.180';
  const mqttPort = process.env.MQTT_PORT || 1883;
  const mqttUrl = `mqtt://${mqttHost}:${mqttPort}`;
  
  console.log('初始化全局MQTT报警客户端，连接到:', mqttUrl);
  
  globalAlarmMqttClient = mqtt.connect(mqttUrl, {
    clientId: `alarm-subscriber-${Date.now()}`,
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000
  });
  
  globalAlarmMqttClient.on('connect', () => {
    console.log('全局MQTT报警客户端连接成功');
    
    // 1. 先订阅我们自己的接收报警主题
    globalAlarmMqttClient.subscribe(RECEIVE_ALARM_TOPIC, (err) => {
      if (err) {
        console.error('订阅实时报警主题失败:', err);
      } else {
        console.log('成功订阅实时报警主题:', RECEIVE_ALARM_TOPIC);
      }
    });
    
    // 历史报警已经移到主MQTT客户端处理，这里只处理实时报警
  });
  
  globalAlarmMqttClient.on('message', (topic, message) => {
    if (topic === RECEIVE_ALARM_TOPIC) {
      try {
        const alarmData = JSON.parse(message.toString());
        console.log('收到SCADA报警数据:', alarmData);
        
        // 检查是否是实时报警数据
        if (alarmData.method === 'RealAlarm' && Array.isArray(alarmData.alarms)) {
          // 遍历所有报警
          alarmData.alarms.forEach(alarm => {
            // 转换报警格式，适配前端显示
            const formattedAlarm = {
              time: new Date(alarm.newtime).toLocaleString('zh-CN'), // 转换为本地时间格式
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
              const userIdNum = parseInt(userId);
              // 只推送给订阅了报警且有设备权限的用户
              if (userAlarmSubscribed.has(userIdNum) && userAlarmSubscribed.get(userIdNum)) {
                const userDevices = userDeviceCache.get(userIdNum);
                if (userDevices && userDevices.has(alarm.name)) {
                  // 有权限且已订阅，推送报警给用户
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'alarm',
                      data: formattedAlarm
                    }));
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
  });
  
  globalAlarmMqttClient.on('error', (error) => {
    console.error('全局MQTT报警客户端错误:', error);
  });
  
  globalAlarmMqttClient.on('close', () => {
    console.log('全局MQTT报警客户端断开连接，尝试重连...');
  });
}

// 初始化报警订阅
initGlobalAlarmMqtt();

// 初始化全局主MQTT客户端（启动时只执行一次）
let globalMainMqttClient = null;
function initGlobalMainMqttClient() {
  const mqttHost = process.env.MQTT_HOST || '192.168.10.180';
  const mqttPort = process.env.MQTT_PORT || 1883;
  const mqttUrl = `mqtt://${mqttHost}:${mqttPort}`;
  
  console.log('初始化全局主MQTT客户端，连接到:', mqttUrl);
  
  globalMainMqttClient = mqtt.connect(mqttUrl, {
    clientId: `global_main_client_${Date.now()}`,
    username: process.env.MQTT_USERNAME || 'web_admin_9',
    password: process.env.MQTT_PASSWORD || 'web_admin_9',
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000
  });

  globalMainMqttClient.on('connect', function () {
      console.log('全局主MQTT客户端连接成功');
      // 同时订阅两个主题，查看返回情况
      globalMainMqttClient.subscribe(['SupconScadaHisAlarm', RECEIVE_HIS_ALARM_TOPIC], function(err) {
        if (!err) {
          console.log('全局订阅历史报警主题成功: SupconScadaHisAlarm,', RECEIVE_HIS_ALARM_TOPIC);
        } else {
          console.error('全局订阅历史报警主题失败:', err);
        }
      });
    });

    // 全局客户端消息处理，专门处理历史报警返回
    globalMainMqttClient.on('message', function(topic, message) {
      if (topic === RECEIVE_HIS_ALARM_TOPIC) {
      try {
        const hisAlarmMsg = JSON.parse(message.toString());
        if (hisAlarmMsg.method === 'HistoryAlarm') {
            console.log(`收到SCADA历史报警查询结果，共${hisAlarmMsg.data?.length || 0}条, seq:${hisAlarmMsg.seq}`);
            
            // 优先按seq匹配用户，匹配不到就用最近的用户ID兜底（双保险确保有返回）
            const userId = historyAlarmQueryMap.get(hisAlarmMsg.seq) || lastHistoryAlarmUserId;
            const userWs = userId ? connectedClients.get(userId) : null;
            
            // 用完删除映射，避免内存泄漏
            if (historyAlarmQueryMap.has(hisAlarmMsg.seq)) {
              historyAlarmQueryMap.delete(hisAlarmMsg.seq);
            }
            lastHistoryAlarmUserId = null;
          
          if (userWs && userWs.readyState === WebSocket.OPEN) {
            // 按用户权限过滤历史报警
            const userDevices = userDeviceCache.get(parseInt(userId));
            const filteredAlarms = [];
            
            if (hisAlarmMsg.data && Array.isArray(hisAlarmMsg.data)) {
              hisAlarmMsg.data.forEach(alarm => {
                if (userDevices && userDevices.has(alarm.name)) {
                  // 格式化历史报警
                  filteredAlarms.push({
                    name: alarm.name,
                    level: alarm.level,
                    type: alarm.type,
                    almdesc: alarm.almdesc,
                    triggerValue: alarm.trigger,
                    limitValue: alarm.limit,
                    occurTime: alarm.newtime,
                    ackTime: alarm.acktime,
                    clearTime: alarm.canceltime,
                    operator: alarm.operate,
                    result: alarm.results
                  });
                }
              });
            }
            
            // 推送给对应用户
            userWs.send(JSON.stringify({
              type: 'history_alarm_result',
              data: filteredAlarms
            }));
            console.log(`已向用户 ${userId} 推送过滤后的历史报警，共${filteredAlarms.length}条`);
          }
        }
      } catch (error) {
        console.error('解析历史报警消息失败:', error);
      }
    }
  });
}

// 启动时初始化全局主MQTT客户端
initGlobalMainMqttClient();

// 启动服务器
server.listen(port, async () => {
  console.log('Server running on http://localhost:' + port);
  console.log('WebSocket server running on ws://localhost:' + port);
  
  try {
    // 测试数据库连接
    await testConnection();
    console.log('服务器启动成功，可以通过 http://localhost:' + port + ' 访问');
    
    // 设置定时刷新缓存（每5分钟刷新一次）
    console.log('设置设备缓存定时刷新，每5分钟执行一次');
    setInterval(refreshAllDeviceCache, 5 * 60 * 1000);
    
  } catch (error) {
    console.error('服务器启动时出错:', error);
  }
});

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  console.error('异常堆栈:', error.stack);
});

// 捕获未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  if (reason && reason.stack) {
    console.error('拒绝原因堆栈:', reason.stack);
  }
});
