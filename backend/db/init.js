// 数据库初始化脚本
const mysql = require('mysql2/promise');
const { DB_CONFIG } = require('../config');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  let connection = null;
  
  try {
    console.log('开始初始化数据库...');
    
    // 读取SQL初始化文件
    const sqlFilePath = path.join(__dirname, 'init.sql');
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
    
    // 创建数据库连接
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('数据库连接成功');
    
    // 分割SQL语句并逐个执行
    // 改进的分割逻辑，处理多行SQL语句和注释
    const statements = [];
    let currentStmt = '';
    
    const lines = sqlContent.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // 跳过空行和注释行
      if (trimmedLine === '' || trimmedLine.startsWith('--')) {
        continue;
      }
      
      currentStmt += line + '\n';
      
      // 如果遇到分号，说明是一条完整的SQL语句
      if (trimmedLine.endsWith(';')) {
        statements.push(currentStmt.trim());
        currentStmt = '';
      }
    }
    
    console.log(`共解析到 ${statements.length} 条SQL语句`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      console.log(`执行第 ${i + 1} 条SQL语句...`);
      try {
        await connection.execute(stmt);
        console.log(`第 ${i + 1} 条SQL语句执行成功`);
      } catch (stmtError) {
        console.warn(`第 ${i + 1} 条SQL语句执行失败，跳过:`, stmtError.message);
      }
    }
    
    console.log('数据库初始化完成');
    
  } catch (error) {
    console.error('数据库初始化失败:', error);
    process.exit(1);
  } finally {
    if (connection) {
      try {
        await connection.end();
        console.log('数据库连接已关闭');
      } catch (closeError) {
        console.error('关闭数据库连接失败:', closeError);
      }
    }
  }
}

// 执行初始化
initDatabase();

