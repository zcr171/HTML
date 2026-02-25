// 全局变量声明
let deviceData = {};                // 设备实时数据，键为设备名称
let alarmData = [];                 // 实时报警数据
let historyAlarmData = [];          // 历史报警数据
let historyData = [];               // 历史数据
let clientId = getClientId();       // 客户端ID

// 生成并存储唯一客户端ID
function getClientId() {
    let id = localStorage.getItem('clientId');
    if (!id) {
        id = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('clientId', id);
    }
    return id;
}

// 后端API基础URL（自动适配当前访问地址）
const API_BASE_URL = window.location.origin + '/api';
