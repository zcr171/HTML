// WebSocket连接实例
let ws = null;

// 连接到WebSocket服务器
function connectWebSocket() {
    console.log('连接到WebSocket服务器...');
    
    // 从localStorage获取用户信息
    const token = localStorage.getItem('token');
    let userId = null;
    
    // 尝试从token中解析userId
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userId = payload.userId;
            console.log('从token中解析出userId:', userId);
        } catch (error) {
            console.error('解析token失败:', error);
        }
    }
    
    // 创建WebSocket连接，传递userId参数（自动适配当前访问地址）
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = userId ? `${wsProtocol}//${window.location.host}?userId=${userId}` : `${wsProtocol}//${window.location.host}`;
    console.log('WebSocket连接URL:', wsUrl);
    window.ws = new WebSocket(wsUrl);
    
    // 连接成功
    window.ws.onopen = function() {
        console.log('WebSocket连接成功');
        // 更新MQTT状态灯
        updateMQTTStatusLights();
    };
    
    // 接收消息
    window.ws.onmessage = function(event) {
    try {
        const message = JSON.parse(event.data);
        console.log('收到WebSocket消息:', message);
            
            // 处理实时数据
            if (message.type === 'realtime_data' && message.data) {
                if (message.data.RTValue && Array.isArray(message.data.RTValue)) {
                    console.log('收到实时数据，包含', message.data.RTValue.length, '个设备:', message.data.RTValue);
                    message.data.RTValue.forEach(deviceData => {
                        console.log('处理单个设备数据:', deviceData);
                        processRealTimeData(deviceData);
                    });
                    // 处理完后防抖更新表格
                    if (window.debouncedUpdateTable) {
                        window.debouncedUpdateTable();
                    } else {
                        updateDeviceDataTable();
                    }
                    console.log('实时数据处理完成，当前deviceData数量:', Object.keys(deviceData).length);
                }
            }
            // 处理报警数据
            else if (message.type === 'alarm_data' && message.data) {
                if (message.data.alarms && Array.isArray(message.data.alarms)) {
                    console.log('收到报警数据，包含', message.data.alarms.length, '个报警');
                    message.data.alarms.forEach(alarmData => {
                        processAlarmData(alarmData);
                    });
                }
            }
            // 处理历史数据
            else if (message.type === 'history_data' && message.data) {
                if (window.processHistoryData) {
                    window.processHistoryData(message); // 直接传完整消息
                }
            }
            // 处理新的实时报警推送
            else if (message.type === 'alarm' && message.data) {
                console.log('收到新的实时报警:', message.data);
                processAlarmData(message.data);
            }
            // 处理历史报警查询结果
            else if (message.type === 'history_alarm_result' && message.data) {
                console.log('收到历史报警查询结果:', message.data);
                if (window.renderHistoryAlarmTable) {
                    window.renderHistoryAlarmTable(message.data);
                }
            }
        } catch (error) {
            console.error('解析WebSocket消息失败:', error);
        }
    };
    
    // 连接关闭
    window.ws.onclose = function() {
        console.log('WebSocket连接关闭');
        // 更新MQTT状态灯
        updateMQTTStatusLights();
        // 尝试重新连接
        setTimeout(connectWebSocket, 3000);
    };
    
    // 连接错误
    window.ws.onerror = function(error) {
        console.error('WebSocket连接错误:', error);
        // 更新MQTT状态灯
        updateMQTTStatusLights();
    };
}

// 连接到后端服务（使用WebSocket）
function connectMQTT() {
    console.log('连接到后端服务...');
    // 连接WebSocket服务器
    connectWebSocket();
    
    console.log('后端服务连接成功，等待实时数据推送');
}

// 断开与后端服务的连接
function disconnectMQTT() {
    console.log('断开与后端服务的连接');
    // 关闭WebSocket连接
    if (window.ws) {
        window.ws.close();
        window.ws = null;
    }
}

// 检查MySQL数据库状态
function checkMySQLStatus() {
    fetch(`${API_BASE_URL}/health`)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            return response.json();
        })
        .then(result => {
            console.log('健康检查接口返回:', result);
            // 更新主库状态灯
            const primaryStatus = document.getElementById('mysql-primary-status');
            if (primaryStatus) {
                primaryStatus.className = 'status-indicator status-online';
            }
            
            // 更新备库状态灯
            const backupStatus = document.getElementById('mysql-backup-status');
            if (backupStatus) {
                backupStatus.className = 'status-indicator status-online';
            }
            
            console.log('数据库状态更新: 服务运行正常');
        })
        .catch(error => {
            console.error('数据库状态检查失败:', error);
            // 出错时设置为离线状态
            const primaryStatus = document.getElementById('mysql-primary-status');
            const backupStatus = document.getElementById('mysql-backup-status');
            if (primaryStatus) primaryStatus.className = 'status-indicator status-offline';
            if (backupStatus) backupStatus.className = 'status-indicator status-offline';
        });
}

// 启动MySQL状态检查
function startMySQLStatusCheck() {
    // 立即检查一次
    checkMySQLStatus();
    
    // 每10秒检查一次
    setInterval(checkMySQLStatus, 10000);
}

// 更新MQTT状态灯
function updateMQTTStatusLights() {
    // 根据WebSocket连接状态更新MQTT状态灯
    const primaryStatus = document.getElementById('mqtt-primary-status');
    const backupStatus = document.getElementById('mqtt-backup-status');
    
    if (primaryStatus) {
        primaryStatus.className = 'status-indicator ' + (window.ws && window.ws.readyState === WebSocket.OPEN ? 'status-online' : 'status-offline');
    }
    
    if (backupStatus) {
        // 备用状态灯也使用相同的状态，因为我们只有一个WebSocket连接
        backupStatus.className = 'status-indicator ' + (window.ws && window.ws.readyState === WebSocket.OPEN ? 'status-online' : 'status-offline');
    }
    
    console.log('MQTT状态灯更新:', {
        connected: window.ws && window.ws.readyState === WebSocket.OPEN,
        readyState: window.ws ? window.ws.readyState : 'not initialized'
    });
}
