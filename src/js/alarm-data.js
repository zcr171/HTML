// 报警数据处理

/**
 * 处理报警数据
 * 功能：处理从MQTT接收到的报警数据，更新报警数据存储和UI
 * 参数：
 * @param {Object} data - 报警数据对象，包含deviceName、type、value等属性
 */
function processAlarmData(data) {
    // 检查数据是否包含clientId，并且与当前客户端ID匹配
    if (data.clientId && data.clientId !== clientId) {
        console.log('忽略其他客户端的报警数据:', data.clientId, '(当前客户端:', clientId, ')');
        return;
    }
    
    // 处理报警数组
    if (Array.isArray(data)) {
        console.log('收到报警数组，共', data.length, '条报警');
        data.forEach(alarm => {
            if (alarm.deviceName) {
                const alarmItem = {
                    time: alarm.time || new Date().toLocaleString('zh-CN'),
                    deviceName: alarm.deviceName,
                    type: alarm.type || (parseFloat(alarm.value) > parseFloat(alarm.hValue || alarm.H) ? '高值报警' : '低值报警'),
                    value: alarm.value || 0,
                    limit: alarm.limit || (parseFloat(alarm.value) > parseFloat(alarm.hValue || alarm.H) ? alarm.hValue || alarm.H : alarm.lValue || alarm.L),
                    status: alarm.status || '未处理',
                    desc: alarm.desc || (deviceData[alarm.deviceName] ? deviceData[alarm.deviceName].desc : '')
                };
                
                // 添加到报警数据数组
                alarmData.unshift(alarmItem);
                if (alarmData.length > 50) {
                    alarmData = alarmData.slice(0, 50);
                }
            }
        });
        
        // 更新报警数据表格
        updateAlarmDataTable();
        
        // 更新综合概况页面统计数据
        updateOverviewStats();
    }
    // 处理单个报警
    else if (data.deviceName) {
        console.log('收到单个报警:', data.deviceName);
        const alarmItem = {
            time: data.time || new Date().toLocaleString('zh-CN'),
            deviceName: data.deviceName,
            type: data.type || (parseFloat(data.value) > parseFloat(data.hValue || data.H) ? '高值报警' : '低值报警'),
            value: data.value || 0,
            limit: data.limit || (parseFloat(data.value) > parseFloat(data.hValue || data.H) ? data.hValue || data.H : data.lValue || data.L),
            status: data.status || '未处理',
            desc: data.desc || (deviceData[data.deviceName] ? deviceData[data.deviceName].desc : '')
        };
        
        // 添加到报警数据数组
        alarmData.unshift(alarmItem);
        if (alarmData.length > 50) {
            alarmData = alarmData.slice(0, 50);
        }
        
        // 更新报警数据表格
        updateAlarmDataTable();
        
        // 更新综合概况页面统计数据
        updateOverviewStats();
    }
    // 处理其他情况
    else {
        console.log('收到无法处理的报警数据格式:', data);
    }
}

/**
 * 更新报警数据表格
 * 功能：根据报警数据数组更新报警数据表格
 */
function updateAlarmDataTable() {
    try {
        const tableBody = document.getElementById('alarm-data-table');
        if (!tableBody) return;
        
        const fragment = document.createDocumentFragment();
        
        alarmData.forEach(alarm => {
            const row = document.createElement('tr');
            // 格式化数字为保留两位小数
            const formattedValue = isNaN(alarm.value) ? '--' : parseFloat(alarm.value).toFixed(2);
            const formattedLimit = isNaN(alarm.limit) ? (alarm.limit || '--') : parseFloat(alarm.limit).toFixed(2);
            
            row.innerHTML = `
                <td class="px-2 py-1">${alarm.time}</td>
                <td class="px-2 py-1">${alarm.deviceName}</td>
                <td class="px-2 py-1">${alarm.desc || '--'}</td>
                <td class="px-2 py-1">${alarm.type}</td>
                <td class="px-2 py-1">${formattedValue}</td>
                <td class="px-2 py-1">${formattedLimit}</td>
                <td class="px-2 py-1">
                    <span class="px-2 py-0.5 text-xs rounded ${alarm.status === '未处理' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
                        ${alarm.status}
                    </span>
                </td>
                <td class="px-2 py-1">
                    <button class="px-2 py-0.5 text-xs bg-gray-200 rounded hover:bg-gray-300 transition-colors">
                        处理
                    </button>
                </td>
            `;
            fragment.appendChild(row);
        });
        
        // 清空表格并添加新行
        tableBody.innerHTML = '';
        tableBody.appendChild(fragment);
        
        // 更新报警数量显示
        document.getElementById('total-alarms').textContent = alarmData.length;
        document.getElementById('unprocessed-alarms').textContent = alarmData.filter(item => item.status === '未处理').length;
        document.getElementById('processed-alarms').textContent = alarmData.filter(item => item.status === '已处理').length;
        
    } catch (error) {
        console.error('更新报警数据表格时出错:', error);
    }
}

/**
 * 搜索报警设备
 * 功能：根据搜索关键词查找设备
 */
function searchAlarmDevices() {
    const searchInput = document.getElementById('alarm-device-search');
    const searchResults = document.getElementById('alarm-search-results');
    
    if (!searchInput || !searchResults) return;
    
    const keyword = searchInput.value.trim();
    if (!keyword) {
        searchResults.classList.add('hidden');
        return;
    }
    
    // 从设备数据中搜索匹配的设备
    const matchedDevices = Object.keys(deviceData).filter(deviceName => 
        deviceName.toLowerCase().includes(keyword.toLowerCase()) ||
        (deviceData[deviceName].desc && deviceData[deviceName].desc.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    // 显示搜索结果
    searchResults.innerHTML = '';
    matchedDevices.forEach(deviceName => {
        const device = deviceData[deviceName];
        const item = document.createElement('div');
        item.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer';
        item.innerHTML = `
            <div class="font-medium">${deviceName}</div>
            <div class="text-xs text-gray-500">${device.desc || ''}</div>
        `;
        item.addEventListener('click', () => {
            // 添加设备到已选设备列表
            addAlarmDeviceToSelection(deviceName);
            searchResults.classList.add('hidden');
        });
        searchResults.appendChild(item);
    });
    
    if (matchedDevices.length > 0) {
        searchResults.classList.remove('hidden');
    } else {
        searchResults.classList.add('hidden');
    }
}

/**
 * 添加报警设备到选择列表
 * 功能：将设备添加到历史报警查询的已选设备列表
 * 参数：
 * @param {string} deviceName - 设备名称
 */
function addAlarmDeviceToSelection(deviceName) {
    const container = document.getElementById('selected-alarm-devices-container');
    const noDevicesMessage = document.getElementById('no-alarm-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 检查设备是否已在选择列表中
    const existingDevices = container.querySelectorAll('.alarm-device-tag');
    for (const device of existingDevices) {
        if (device.dataset.deviceName === deviceName) {
            return; // 设备已存在，不再添加
        }
    }
    
    // 隐藏无设备消息
    if (noDevicesMessage) {
        noDevicesMessage.classList.add('hidden');
    }
    
    // 创建设备标签
    const deviceTag = document.createElement('div');
    deviceTag.className = 'alarm-device-tag bg-gray-100 px-2 py-1 rounded-full text-xs flex items-center space-x-1';
    deviceTag.dataset.deviceName = deviceName;
    deviceTag.innerHTML = `
        <span>${deviceName}</span>
        <button class="text-gray-400 hover:text-gray-600" onclick="removeAlarmDeviceFromSelection('${deviceName}')">
            <i class="fa fa-times-circle"></i>
        </button>
    `;
    
    container.appendChild(deviceTag);
}

/**
 * 从选择列表中移除报警设备
 * 功能：从历史报警查询的已选设备列表中移除设备
 * 参数：
 * @param {string} deviceName - 设备名称
 */
function removeAlarmDeviceFromSelection(deviceName) {
    const container = document.getElementById('selected-alarm-devices-container');
    const noDevicesMessage = document.getElementById('no-alarm-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 找到并移除设备标签
    const deviceTag = container.querySelector(`.alarm-device-tag[data-device-name="${deviceName}"]`);
    if (deviceTag) {
        deviceTag.remove();
    }
    
    // 检查是否还有设备，如果没有，显示无设备消息
    const remainingDevices = container.querySelectorAll('.alarm-device-tag');
    if (remainingDevices.length === 0 && noDevicesMessage) {
        noDevicesMessage.classList.remove('hidden');
    }
}

/**
 * 重置报警设备选择
 * 功能：清空历史报警查询的已选设备列表
 */
function resetAlarmDeviceSelection() {
    const container = document.getElementById('selected-alarm-devices-container');
    const noDevicesMessage = document.getElementById('no-alarm-devices-message');
    const searchInput = document.getElementById('alarm-device-search');
    
    if (!container || !noDevicesMessage) return;
    
    // 清空设备标签
    const deviceTags = container.querySelectorAll('.alarm-device-tag');
    deviceTags.forEach(tag => tag.remove());
    
    // 显示无设备消息
    noDevicesMessage.classList.remove('hidden');
    
    // 清空搜索输入
    if (searchInput) {
        searchInput.value = '';
    }
}

// 将函数添加到window对象，确保在全局作用域中可用
if (typeof window !== 'undefined') {
    window.searchAlarmDevices = searchAlarmDevices;
    window.addAlarmDeviceToSelection = addAlarmDeviceToSelection;
    window.removeAlarmDeviceFromSelection = removeAlarmDeviceFromSelection;
    window.resetAlarmDeviceSelection = resetAlarmDeviceSelection;
}
