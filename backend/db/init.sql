-- 数据库初始化脚本

-- 创建device表
CREATE TABLE IF NOT EXISTS device (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_no VARCHAR(50) NOT NULL UNIQUE COMMENT '设备编号',
  description VARCHAR(255) NOT NULL COMMENT '设备描述',
  unit VARCHAR(20) COMMENT '单位',
  qty_min DECIMAL(10,2) COMMENT '最小值',
  qty_max DECIMAL(10,2) COMMENT '最大值',
  H DECIMAL(10,2) COMMENT '高限',
  L DECIMAL(10,2) COMMENT '低限',
  HH DECIMAL(10,2) COMMENT '高高限',
  LL DECIMAL(10,2) COMMENT '低低限',
  type VARCHAR(50) COMMENT '设备类型',
  factory INT NOT NULL COMMENT '工厂编号',
  level INT NOT NULL COMMENT '区域等级',
  is_major_hazard TINYINT(1) DEFAULT 0 COMMENT '是否重大危险源',
  is_sis TINYINT(1) DEFAULT 0 COMMENT '是否SIS系统',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备信息表';

-- 创建web_user表
CREATE TABLE IF NOT EXISTS web_user (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  password VARCHAR(255) NOT NULL COMMENT '密码',
  realname VARCHAR(50) NOT NULL COMMENT '真实姓名',
  role VARCHAR(20) DEFAULT 'user' COMMENT '角色',
  factory_level INT NOT NULL COMMENT '工厂权限等级',
  area_level INT NOT NULL COMMENT '区域等级',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='web用户表';

-- 创建laws_docs表
CREATE TABLE IF NOT EXISTS laws_docs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  law_title VARCHAR(255) NOT NULL COMMENT '法规标题',
  law_type VARCHAR(50) COMMENT '法规类型',
  issuing_no VARCHAR(100) COMMENT '发文字号',
  implement_date DATE COMMENT '实施日期',
  file_path VARCHAR(255) COMMENT '文件路径',
  file_name VARCHAR(255) COMMENT '文件名',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='法律法规文档表';

-- 创建standard_docs表
CREATE TABLE IF NOT EXISTS standard_docs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doc_title VARCHAR(255) NOT NULL COMMENT '标准标题',
  doc_type VARCHAR(50) COMMENT '标准类型',
  issuing_no VARCHAR(100) COMMENT '标准编号',
  release_date DATE COMMENT '发布日期',
  file_path VARCHAR(255) COMMENT '文件路径',
  file_name VARCHAR(255) COMMENT '文件名',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标准规范文档表';

-- 创建policy_docs表
CREATE TABLE IF NOT EXISTS policy_docs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  policy_name VARCHAR(255) NOT NULL COMMENT '制度名称',
  policy_type VARCHAR(50) COMMENT '制度类型',
  policy_code VARCHAR(100) COMMENT '制度编号',
  publish_time DATE COMMENT '发布时间',
  status TINYINT(1) DEFAULT 1 COMMENT '状态',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业制度文档表';

-- 插入测试用户数据
INSERT IGNORE INTO web_user (username, password, realname, role, factory_level, area_level) VALUES
('admin', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', '管理员', 'admin', 99, 5),
('user', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', '普通用户', 'user', 30, 3);

-- 插入测试设备数据
INSERT IGNORE INTO device (device_no, description, unit, qty_min, qty_max, H, L, HH, LL, type, factory, level, is_major_hazard, is_sis) VALUES
('D001', '反应釜温度', '℃', 0, 100, 80, 20, 90, 10, 'temperature', 2, 1, 1, 1),
('D002', '反应釜压力', 'MPa', 0, 5, 4, 1, 4.5, 0.5, 'pressure', 2, 1, 1, 1),
('D003', '储罐液位', 'm', 0, 10, 8, 2, 9, 1, 'level', 4, 2, 1, 0),
('D004', '流量计', 'm³/h', 0, 100, 80, 20, 90, 10, 'flow', 8, 3, 0, 0),
('D005', '电机电流', 'A', 0, 50, 40, 10, 45, 5, 'current', 16, 2, 0, 0),
('D006', '电机电压', 'V', 380, 420, 410, 390, 415, 385, 'voltage', 32, 1, 0, 0);
