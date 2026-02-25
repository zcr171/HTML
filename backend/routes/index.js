console.log('🔥🔥🔥 routes/index.js 被加载了！🔥🔥🔥');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { pool, getUserDevices } = require('../db');
const { parseFactoryLevel } = require('../utils');
const { JWT_SECRET, SUPER_ADMIN_LEVEL } = require('../config');
const { userInfoCache, userDeviceCache } = require('../cache');


const router = express.Router();

// 登录接口
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名和密码不能为空' 
      });
    }

    // 查询用户
    const [results] = await pool.execute(
      'SELECT * FROM web_user WHERE username = ?', 
      [username]
    );

    if (results.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    const user = results[0];
    
    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    // 生成JWT token，有效期24小时
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role 
      }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 缓存用户信息
    userInfoCache.set(user.id.toString(), user);

    // 预加载设备权限缓存
    try {
      const isSuperAdmin = user.factory_level === SUPER_ADMIN_LEVEL;
      const factories = parseFactoryLevel(user.factory_level);
      const devices = await getUserDevices(user.id.toString(), factories, user.area_level, isSuperAdmin);
      const deviceSet = new Set(devices.map(d => d.device_no));
      userDeviceCache.set(user.id.toString(), deviceSet);
      console.log(`用户 ${user.id} 登录时预加载设备权限完成，共 ${devices.length} 个设备`);
    } catch (cacheError) {
      console.error('预加载设备权限失败:', cacheError);
    }

    res.json({
      success: true,
      message: '登录成功',
      token, // 放到最外层
      user: { // 放到最外层
        id: user.id,
        username: user.username,
        realname: user.realname,
        role: user.role,
        factory_level: user.factory_level,
        area_level: user.area_level
      },
      data: { // 保留 data 字段，放 allowedDevices 或其他扩展数据
        allowedDevices: [] // 这里可以留空，或者你有需要可以填数据
      }
    });

  } catch (error) {
    console.error('登录接口错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器内部错误' 
    });
  }
});

// 获取设备列表接口
router.get('/devices', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId.toString();

    console.log('获取设备列表请求');
    
    // 检查用户信息和设备缓存
    if (!userInfoCache.has(userId)) {
      console.log('用户信息缓存不存在，从数据库查询');
      const [userResults] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
      if (userResults.length === 0) {
        return res.status(401).json({ 
          success: false, 
          message: '用户不存在' 
        });
      }
      userInfoCache.set(userId, userResults[0]);
    }

    const userInfo = userInfoCache.get(userId);
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN_LEVEL;
    const factories = parseFactoryLevel(userInfo.factory_level);
    
    const devices = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    
    // 更新设备缓存
    const deviceSet = new Set(devices.map(d => d.device_no));
    userDeviceCache.set(userId, deviceSet);

    res.json({
      success: true,
      message: '获取设备列表成功',
      data: devices
    });
  } catch (error) {
    console.error('获取设备列表接口错误:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: '无效的token' 
      });
    }
    res.status(500).json({ 
      success: false, 
      message: '服务器内部错误' 
    });
  }
});

// 健康检查接口
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: '服务运行正常',
    timestamp: new Date().toISOString()
  });
});

// 法律法规搜索接口
router.post('/laws/search', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
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
router.post('/standards/search', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { keyword } = req.body;
    
    let query = `
      SELECT doc_title, doc_type, issuing_no, release_date, file_path, file_name 
      FROM standard_docs 
      WHERE status = 1
    `;
    let params = [];
    
    if (keyword) {
      query += ` AND (doc_title LIKE ? OR issuing_no LIKE ?)`;
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

// 企业制度搜索接口
router.post('/policies/search', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    const { keyword } = req.body;
    
    let query = `
      SELECT policy_name, policy_type, policy_code, publish_time 
      FROM policy_docs 
      WHERE status = 1
    `;
    let params = [];
    
    if (keyword) {
      query += ` AND (policy_name LIKE ? OR policy_code LIKE ?)`;
      params = [`%${keyword}%`, `%${keyword}%`];
    }
    
    // 执行查询
    const [rows] = await pool.execute(query, params);
    
    // 返回结果
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('搜索企业制度失败:', error);
    res.json({ success: false, message: '搜索失败，请稍后重试' });
  }
});

// 历史数据查询接口
router.get('/history/data', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId.toString();

    console.log('历史数据查询请求');
    
    // 检查用户信息和设备缓存
    if (!userInfoCache.has(userId)) {
      console.log('用户信息缓存不存在，从数据库查询');
      const [userResults] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
      if (userResults.length === 0) {
        return res.status(401).json({ 
          success: false, 
          message: '用户不存在' 
        });
      }
      userInfoCache.set(userId, userResults[0]);
    }

    const userInfo = userInfoCache.get(userId);
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN_LEVEL;
    const factories = parseFactoryLevel(userInfo.factory_level);
    
    const devices = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    
    // 更新设备缓存
    const deviceSet = new Set(devices.map(d => d.device_no));
    userDeviceCache.set(userId, deviceSet);

    res.json({
      success: true,
      message: '历史数据查询接口已实现，实际查询通过WebSocket+MQTT进行',
      data: {
        devices: devices.map(d => d.device_no),
        message: '请通过WebSocket发送查询请求到SupconScadaHisData主题'
      }
    });
  } catch (error) {
    console.error('历史数据查询接口错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器内部错误' 
    });
  }
});

// 历史报警查询接口
router.get('/history/alarms', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId.toString();

    console.log('历史报警查询请求');
    
    // 检查用户信息和设备缓存
    if (!userInfoCache.has(userId)) {
      console.log('用户信息缓存不存在，从数据库查询');
      const [userResults] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
      if (userResults.length === 0) {
        return res.status(401).json({ 
          success: false, 
          message: '用户不存在' 
        });
      }
      userInfoCache.set(userId, userResults[0]);
    }

    res.json({
      success: true,
      message: '历史报警查询接口已实现，实际查询通过WebSocket+MQTT进行',
      data: {
        message: '请通过WebSocket发送查询请求到SupconScadaHisAlarm主题'
      }
    });
  } catch (error) {
    console.error('历史报警查询接口错误:', error);
    res.status(500).json({ 
      success: false, 
      message: '服务器内部错误' 
    });
  }
});

// 管理员：获取所有用户列表
router.get('/admin/users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId.toString();

    // 检查是否为超级管理员
    if (!userInfoCache.has(userId)) {
      const [userResults] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
      if (userResults.length === 0 || userResults[0].factory_level !== SUPER_ADMIN_LEVEL) {
        return res.status(403).json({ 
          success: false, 
          message: '无管理员权限' 
        });
      }
      userInfoCache.set(userId, userResults[0]);
    } else {
      const userInfo = userInfoCache.get(userId);
      if (userInfo.factory_level !== SUPER_ADMIN_LEVEL) {
        return res.status(403).json({ 
          success: false, 
          message: '无管理员权限' 
        });
      }
    }

    const [users] = await pool.execute('SELECT id, username, realname, factory_level, area_level, enabled, create_time FROM web_user ORDER BY id');
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// 管理员：创建新用户
router.post('/admin/users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: '未授权访问' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId.toString();

    // 检查是否为超级管理员
    if (!userInfoCache.has(userId)) {
      const [userResults] = await pool.execute('SELECT * FROM web_user WHERE id = ?', [userId]);
      if (userResults.length === 0 || userResults[0].factory_level !== SUPER_ADMIN_LEVEL) {
        return res.status(403).json({ 
          success: false, 
          message: '无管理员权限' 
        });
      }
      userInfoCache.set(userId, userResults[0]);
    } else {
      const userInfo = userInfoCache.get(userId);
      if (userInfo.factory_level !== SUPER_ADMIN_LEVEL) {
        return res.status(403).json({ 
          success: false, 
          message: '无管理员权限' 
        });
      }
    }

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
    
    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);
    
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

module.exports = router;