const mysql = require('mysql2/promise');
const { DB_CONFIG } = require('../config');

// 创建数据库连接池
const pool = mysql.createPool(DB_CONFIG);

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('数据库连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error);
    return false;
  }
}

// 查询用户信息
async function getUserById(userId) {
  const [results] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
  return results.length > 0 ? results[0] : null;
}

// 查询用户设备权限
async function getUserDevices(userId, factories, areaLevel, isSuperAdmin) {
  let query = '';
  let params = [];

  if (isSuperAdmin) {
    // 超级管理员返回所有设备
    query = 'SELECT device_no, description, unit, qty_max, qty_min, H, L, HH, LL, factory, level, is_major_hazard, is_sis FROM device_data';
  } else {
    // 普通用户根据工厂权限和区域等级查询
    if (factories.length === 0) {
      console.log('用户无工厂权限，返回空设备列表');
      return [];
    }
    
    const placeholders = factories.map(() => '?').join(',');
    query = `SELECT device_no, description, unit, qty_max, qty_min, H, L, HH, LL, factory, level, is_major_hazard, is_sis 
             FROM device_data 
             WHERE factory IN (${placeholders}) AND (level IS NULL OR level <= ?)`;
    params = [...factories, areaLevel];
  }

  try {
    const [results] = await pool.execute(query, params);
    console.log(`查询到 ${results.length} 个设备`);
    return results;
  } catch (error) {
    console.error('查询设备权限失败:', error);
    return [];
  }
}

module.exports = {
  pool,
  testConnection,
  getUserById,
  getUserDevices
};