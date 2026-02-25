// 模拟间隔变量
let simulationInterval = null;

// 表格更新防抖，每500ms最多刷新一次，避免频繁DOM操作导致卡顿
let updateTableTimer = null;
function debouncedUpdateTable() {
    clearTimeout(updateTableTimer);
    updateTableTimer = setTimeout(updateDeviceDataTable, 500);
}

/**
 * 处理实时数据
 * 功能：处理从MQTT接收到的设备实时数据，更新设备数据存储和UI
 * 参数：
 * @param {Object} data - 设备实时数据对象，包含name、value等属性
 * 实现：
 * 1. 验证数据格式，确保包含设备名称
 * 2. 存储设备数据，包括基本参数、报警阈值等
 * 3. 检查设备值是否在报警范围内
 * 4. 必要时创建新的报警记录
 * 5. 更新设备数据表格和历史数据设备选择
 * 6. 更新综合概况页面统计数据
 */
function processRealTimeData(data) {
    
    if (data.name) {
        const deviceName = data.name;
        if (!deviceData[deviceName]) {
            // 如果设备不存在，创建新设备记录
            deviceData[deviceName] = {
                // 基本参数
                value: data.value || data.v || data.val || data.currentValue || data.RTValue || data.rtValue || 0,
                type: data.type || null,
                quality: data.quality || null,
                timestamp: data.timestamp || null,
                desc: data.desc || '',
                unit: device.unit || data.unit || '',
                
                // 报警阈值
                hhValue: data.hhValue !== undefined ? data.hhValue : (data.HH !== undefined ? data.HH : null),
                hValue: data.hValue !== undefined ? data.hValue : (data.H !== undefined ? data.H : null),
                lValue: data.lValue !== undefined ? data.lValue : (data.L !== undefined ? data.L : null),
                llValue: data.llValue !== undefined ? data.llValue : (data.LL !== undefined ? data.LL : null),
                
                // 量程
                minRange: null,
                maxRange: null,
                
                // 其他参数
                alarmCount: data.alarmCount || 0,
                status: data.status || '正常',
                updateTime: new Date().toLocaleString('zh-CN')
            };
        } else {
            // 如果设备已存在，只更新实时值和相关参数，保留从数据库获取的信息
            deviceData[deviceName].value = data.value || data.v || data.val || data.currentValue || data.RTValue || data.rtValue || deviceData[deviceName].value;
            deviceData[deviceName].type = data.type || deviceData[deviceName].type;
            deviceData[deviceName].quality = data.quality || deviceData[deviceName].quality;
            deviceData[deviceName].timestamp = data.timestamp || deviceData[deviceName].timestamp;
            // 不要覆盖从数据库获取的描述和报警阈值
            // 只在数据库信息不存在时使用MQTT数据
            deviceData[deviceName].desc = deviceData[deviceName].desc || data.desc || '';
            deviceData[deviceName].hhValue = deviceData[deviceName].hhValue !== null ? deviceData[deviceName].hhValue : (data.hhValue !== undefined ? data.hhValue : (data.HH !== undefined ? data.HH : null));
            deviceData[deviceName].hValue = deviceData[deviceName].hValue !== null ? deviceData[deviceName].hValue : (data.hValue !== undefined ? data.hValue : (data.H !== undefined ? data.H : null));
            deviceData[deviceName].lValue = deviceData[deviceName].lValue !== null ? deviceData[deviceName].lValue : (data.lValue !== undefined ? data.lValue : (data.L !== undefined ? data.L : null));
            deviceData[deviceName].llValue = deviceData[deviceName].llValue !== null ? deviceData[deviceName].llValue : (data.llValue !== undefined ? data.llValue : (data.LL !== undefined ? data.LL : null));
            // 不要覆盖从数据库获取的量程信息
            deviceData[deviceName].updateTime = new Date().toLocaleString('zh-CN');
        }
        
        // 报警逻辑已移至后端，通过专门的MQTT报警主题推送，前端不再自动判断报警
        // 避免重复报警和误判，报警完全由SCADA系统统一产生
        
        debouncedUpdateTable();
        updateHistoryDeviceSelect();
        updateOverviewStats();
    }
}

// 防抖函数，用于优化频繁的DOM更新
function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 防抖处理的设备数据表格更新函数
const debouncedUpdateDeviceDataTable = debounce(updateDeviceDataTable, 100);

// 更新设备数据表格
function updateDeviceDataTable() {
    try {
        const tableBody = document.getElementById('device-data-table');
        if (!tableBody) return;
        
        const fragment = document.createDocumentFragment();
        
        Object.keys(deviceData).forEach(deviceName => {
            const device = deviceData[deviceName];
            const row = document.createElement('tr');
            
            // 检查值是否为数字，不是数字则显示为"--"，是数字则保留两位小数
            const displayValue = isNaN(device.value) ? '--' : parseFloat(device.value).toFixed(2);
            // 数值加上单位
            const valueWithUnit = device.unit ? `${displayValue} ${device.unit}` : displayValue;
            
            row.innerHTML = `
                <td class="px-3 py-2 text-center">${deviceName}</td>
                <td class="px-3 py-2">${device.desc || '--'}</td>
                <td class="px-3 py-2 text-center font-medium">${valueWithUnit}</td>
                <td class="px-3 py-2 text-center">${device.minRange !== undefined && device.minRange !== null && device.maxRange !== undefined && device.maxRange !== null ? `${device.minRange}-${device.maxRange} ${device.unit || ''}` : '--'}</td>
                <td class="px-3 py-2 text-center">${device.hhValue !== undefined && device.hhValue !== null ? device.hhValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.hValue !== undefined && device.hValue !== null ? device.hValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.lValue !== undefined && device.lValue !== null ? device.lValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.llValue !== undefined && device.llValue !== null ? device.llValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.factory !== undefined && device.factory !== null ? device.factory : '--'}</td>
                <td class="px-3 py-2 text-center">${device.is_major_hazard !== undefined && device.is_major_hazard !== null ? (device.is_major_hazard === '是' || device.is_major_hazard === 1 ? '是' : '否') : '--'}</td>
                <td class="px-3 py-2 text-center">${device.is_sis !== undefined && device.is_sis !== null ? (device.is_sis === '是' || device.is_sis === 1 ? '是' : '否') : '--'}</td>
            `;
            
            fragment.appendChild(row);
        });
        
        // 清空表格并添加新行
        tableBody.innerHTML = '';
        tableBody.appendChild(fragment);
        
        // 更新设备数量显示
        const totalDevicesElement = document.getElementById('total-devices');
        const onlineDevicesElement = document.getElementById('online-devices');
        if (totalDevicesElement) {
            totalDevicesElement.textContent = Object.keys(deviceData).length;
        }
        if (onlineDevicesElement) {
            onlineDevicesElement.textContent = Object.keys(deviceData).length;
        }
        
    } catch (error) {
        console.error('更新设备数据表格时出错:', error);
    }
}

// 从后端获取设备信息
async function fetchDevicesFromBackend() {
    try {
        console.log('从后端获取设备信息...');
        const token = localStorage.getItem('token');
        console.log('使用的token:', token);
        
        const response = await fetch(`${API_BASE_URL}/devices`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            console.error('获取设备信息失败，状态码:', response.status);
            throw new Error('HTTP error ' + response.status);
        }
        const devices = await response.json();
        console.log('从后端获取设备信息成功，共', devices.data ? devices.data.length : 0, '个设备');
        console.log('后端返回的设备数据:', devices);
        
        // 处理获取到的设备信息
        if (devices.success && devices.data) {
            devices.data.forEach(device => {
                if (device.device_no) {
                    const deviceName = device.device_no;
                    if (!deviceData[deviceName]) {
                        deviceData[deviceName] = {
                            value: 0,
                            desc: device.description !== undefined && device.description !== null ? device.description : '',
                            unit: device.unit !== undefined && device.unit !== null ? device.unit : '',
                            minRange: device.qty_min !== undefined ? device.qty_min : null,
                            maxRange: device.qty_max !== undefined ? device.qty_max : null,
                            hhValue: device.HH !== undefined ? device.HH : null,
                            hValue: device.H !== undefined ? device.H : null,
                            lValue: device.L !== undefined ? device.L : null,
                            llValue: device.LL !== undefined ? device.LL : null,
                            type: device.type !== undefined && device.type !== null ? device.type : '',
                            quality: device.quality !== undefined && device.quality !== null ? device.quality : null,
                            timestamp: device.timestamp !== undefined && device.timestamp !== null ? device.timestamp : null,
                            alarmCount: device.alarmCount !== undefined && device.alarmCount !== null ? device.alarmCount : 0,
                            status: device.status !== undefined && device.status !== null ? device.status : '正常',
                            factory: device.factory !== undefined ? device.factory : null,
                            level: device.level !== undefined ? device.level : null,
                            is_major_hazard: device.is_major_hazard !== undefined ? device.is_major_hazard : null,
                            is_sis: device.is_sis !== undefined ? device.is_sis : null,
                            updateTime: new Date().toLocaleString('zh-CN')
                        };
                    } else {
                        // 更新现有设备信息
                        deviceData[deviceName].desc = device.description !== undefined && device.description !== null ? device.description : deviceData[deviceName].desc;
                        deviceData[deviceName].unit = device.unit !== undefined && device.unit !== null ? device.unit : deviceData[deviceName].unit;
                        deviceData[deviceName].minRange = device.qty_min !== undefined ? device.qty_min : deviceData[deviceName].minRange;
                        deviceData[deviceName].maxRange = device.qty_max !== undefined ? device.qty_max : deviceData[deviceName].maxRange;
                        deviceData[deviceName].hhValue = device.HH !== undefined ? device.HH : deviceData[deviceName].hhValue;
                        deviceData[deviceName].hValue = device.H !== undefined ? device.H : deviceData[deviceName].hValue;
                        deviceData[deviceName].lValue = device.L !== undefined ? device.L : deviceData[deviceName].lValue;
                        deviceData[deviceName].llValue = device.LL !== undefined ? device.LL : deviceData[deviceName].llValue;
                        deviceData[deviceName].type = device.type !== undefined && device.type !== null ? device.type : deviceData[deviceName].type;
                        deviceData[deviceName].factory = device.factory !== undefined ? device.factory : deviceData[deviceName].factory;
                        deviceData[deviceName].level = device.level !== undefined ? device.level : deviceData[deviceName].level;
                        deviceData[deviceName].is_major_hazard = device.is_major_hazard !== undefined ? device.is_major_hazard : deviceData[deviceName].is_major_hazard;
                        deviceData[deviceName].is_sis = device.is_sis !== undefined ? device.is_sis : deviceData[deviceName].is_sis;
                    }
                }
            });
        }
        
        // 更新设备数据表格
        updateDeviceDataTable();
        // 更新历史数据设备选择
        updateHistoryDeviceSelect();
        // 更新综合概况统计数据
        updateOverviewStats();
        
        console.log('设备信息处理完成，当前deviceData中的设备数量:', Object.keys(deviceData).length);
    } catch (error) {
        console.error('从后端获取设备信息失败:', error);
        // 如果从后端获取失败，不尝试从本地存储获取
    }
}

// 更新历史数据设备选择
function updateHistoryDeviceSelect() {
    // 这里可以添加更新历史数据设备选择的逻辑
    // 例如更新历史数据查询页面的设备选择下拉框
}

// 更新综合概况页面统计数据
function updateOverviewStats() {
    // 更新设备总数
    const totalDevices = Object.keys(deviceData).length;
    document.getElementById('total-devices-overview').textContent = totalDevices;
    document.getElementById('total-devices').textContent = totalDevices;
    
    // 简单计算在线设备数（这里假设所有设备都是在线的，实际应用中需要根据设备状态判断）
    const onlineDevices = totalDevices;
    document.getElementById('online-devices-overview').textContent = onlineDevices;
    document.getElementById('online-devices').textContent = onlineDevices;
    
    // 计算全厂自控率（这里使用模拟值，基于设备总数和报警数量计算）
    let autoControlRate = 0;
    if (totalDevices > 0) {
        // 基础全厂自控率为90%，每增加一个报警减少2%
        autoControlRate = Math.max(0, 90 - alarmData.length * 2);
    }
    document.getElementById('auto-control-rate').textContent = autoControlRate.toFixed(1) + '%';
    
    // 更新报警数量
    const alarmCount = alarmData.length;
    document.getElementById('alarm-count-overview').textContent = alarmCount;
    document.getElementById('alarm-count').textContent = alarmCount;
    document.getElementById('total-alarms').textContent = alarmCount;
}

// 暴露到全局作用域，供其他模块调用
window.fetchDevicesFromBackend = fetchDevicesFromBackend;
window.updateDeviceDataTable = updateDeviceDataTable;
window.debouncedUpdateTable = debouncedUpdateTable;
window.deviceData = deviceData;

// 页面加载完成后自动获取设备信息
document.addEventListener('DOMContentLoaded', () => {
    console.log('device-data.js加载完成，准备获取设备信息...');
    // 检查是否已经登录
    const token = localStorage.getItem('token');
    if (token && window.location.pathname !== '/login.html') {
        setTimeout(() => {
            console.log('已登录，开始获取设备信息...');
            fetchDevicesFromBackend();
        }, 300);
    }
});
