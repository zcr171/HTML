require('dotenv').config();

module.exports = {
  // 服务配置
  PORT: process.env.PORT || 3004,
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  SUPER_ADMIN_LEVEL: 99,

  // MySQL配置
  DB_CONFIG: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scada_web',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },

  // MQTT配置
  MQTT_CONFIG: {
    host: process.env.MQTT_HOST || 'localhost',
    port: process.env.MQTT_PORT || 1883,
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    clientIdPrefix: 'industrial-backend-',
    connectTimeout: 5000,
    reconnectPeriod: 1000
  },

  // 工厂权限映射
  FACTORY_MAP: {
    RD: 2,
    QH: 4,
    JH: 8,
    HS: 16,
    DW: 32
  },

  // MQTT主题映射
  FACTORY_TOPIC_MAP: {
    2: 'rdvalue',
    4: 'qhvalue',
    8: 'jhvalue',
    16: 'hsvalue',
    32: 'dwvalue'
  },

  // SCADA主题配置
  SCADA_TOPICS: {
    HISTORY_DATA: 'hisdatatest',
    HISTORY_ALARM: 'SupconScadaHisAlarm',
    REALTIME_ALARM: 'backend/real/alarm'
  }
};