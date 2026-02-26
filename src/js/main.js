// 主入口文件

// 全局请求拦截：处理异地登录提示
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // 检查401状态（未授权）
    if (response.status === 401) {
        try {
            const data = await response.clone().json();
            // 如果是异地登录提示，强制跳转到登录页
            if (data.msg && data.msg.includes('其他地方登录')) {
                alert('您的账号已在其他设备登录，您已被强制下线');
                // 清除本地登录信息
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                localStorage.removeItem('realname');
                localStorage.removeItem('factoryLevel');
                // 跳转到登录页
                window.location.href = '/login.html';
                return response;
            }
        } catch (e) {
            // 忽略JSON解析错误
        }
    }
    
    return response;
};

/**
 * 更新系统时间
 * 功能：实时更新系统时间显示
 */
function updateSystemTime() {
    const now = new Date();
    const timeElement = document.getElementById('system-time');
    if (timeElement) {
        timeElement.textContent = now.toLocaleString('zh-CN');
    }
}

/**
 * 设置默认时间值
 * 功能：为历史数据查询设置默认时间范围
 */
function setDefaultTimeValues() {
    // 设置历史数据查询默认时间
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 10 * 60 * 1000);
    
    // 格式化时间为YYYY-MM-DDTHH:MM格式
    const formatTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    
    // 设置历史数据查询时间
    const historyStartTime = document.getElementById('history-start-time');
    const historyEndTime = document.getElementById('history-end-time');
    if (historyStartTime) historyStartTime.value = formatTime(oneHourAgo);
    if (historyEndTime) historyEndTime.value = formatTime(now);
    
    // 设置历史报警查询时间
    const alarmHistoryStartTime = document.getElementById('alarm-history-start-time');
    const alarmHistoryEndTime = document.getElementById('alarm-history-end-time');
    if (alarmHistoryStartTime) alarmHistoryStartTime.value = formatTime(oneHourAgo);
    if (alarmHistoryEndTime) alarmHistoryEndTime.value = formatTime(now);
}

/**
 * 初始化事件监听器
 * 功能：为页面元素添加事件监听器
 */
function initEventListeners() {
    // 菜单切换事件
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // 移除所有菜单项的活动状态
            menuItems.forEach(menuItem => {
                menuItem.classList.remove('active', 'bg-primary/20', 'text-white');
                menuItem.classList.add('text-gray-300');
            });
            
            // 添加当前菜单项的活动状态
            this.classList.add('active', 'bg-primary/20', 'text-white');
            this.classList.remove('text-gray-300');
            
            // 获取目标页面
            const target = this.dataset.target;
            if (target) {
                // 隐藏所有页面
                const pageContents = document.querySelectorAll('.page-content');
                pageContents.forEach(page => {
                    page.classList.add('hidden');
                });
                
                // 显示目标页面
                const targetPage = document.getElementById(target);
                if (targetPage) {
                    targetPage.classList.remove('hidden');
                    
                    // 更新页面标题
                    const pageTitle = document.getElementById('page-title');
                    if (pageTitle) {
                        pageTitle.textContent = this.querySelector('span').textContent;
                    }
                    
                    // 如果是综合概况页面，更新图表
                    if (target === 'overview') {
                        updateCharts();
                    }
                }
            }
        });
    });
    
    // 配置按钮事件
    const configBtn = document.getElementById('config-btn');
    const configModal = document.getElementById('config-modal');
    const closeConfigModal = document.getElementById('close-config-modal');
    const cancelConfig = document.getElementById('cancel-config');
    const saveConfig = document.getElementById('save-config');
    
    if (configBtn && configModal) {
        configBtn.addEventListener('click', function() {
            configModal.classList.remove('hidden');
        });
    }
    
    if (closeConfigModal && configModal) {
        closeConfigModal.addEventListener('click', function() {
            configModal.classList.add('hidden');
        });
    }
    
    if (cancelConfig && configModal) {
        cancelConfig.addEventListener('click', function() {
            configModal.classList.add('hidden');
        });
    }
    
    if (saveConfig && configModal) {
        saveConfig.addEventListener('click', function() {
            // 保存配置逻辑
            console.log('保存配置');
            configModal.classList.add('hidden');
        });
    }
    
    // 点击模态框外部关闭
    if (configModal) {
        configModal.addEventListener('click', function(e) {
            if (e.target === configModal) {
                configModal.classList.add('hidden');
            }
        });
    }
    
    // 导入按钮事件
    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', function() {
            const csvFile = document.getElementById('csv-file');
            if (csvFile && csvFile.files.length > 0) {
                console.log('导入CSV文件:', csvFile.files[0].name);
                // 这里可以添加CSV文件处理逻辑
            } else {
                alert('请选择CSV文件');
            }
        });
    }
    
    // 连接/断开按钮事件
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    
    if (connectBtn) {
        connectBtn.addEventListener('click', function() {
            console.log('连接MQTT');
            connectMQTT();
        });
    }
    
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', function() {
            console.log('断开MQTT');
            disconnectMQTT();
        });
    }
}

/**
 * 初始化表格列宽调整功能
 * 功能：允许用户调整表格列宽
 */
function initTableResizing() {
    // 这里可以添加表格列宽调整的实现
    console.log('表格列宽调整功能已初始化');
}

// 跳转到对应页面
window.navigateToPage = function(pageId) {
    // 隐藏所有页面
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.add('hidden');
    });
    // 显示目标页面
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    // 高亮对应的菜单项
    document.querySelectorAll('.menu-item').forEach(item => {
        if (item.dataset.target === pageId) {
            item.classList.add('bg-white/10');
        } else {
            item.classList.remove('bg-white/10');
        }
    });
};

// 报警订阅状态：默认未订阅
    window.alarmSubscribed = false;

// 切换报警订阅/取消订阅
window.toggleAlarmSubscription = function() {
    const btn = document.getElementById('alarm-subscribe-btn');
    if (!btn) return;
    
    window.alarmSubscribed = !window.alarmSubscribed;
    
    // 发送订阅/取消订阅请求到后端
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'alarm_subscribe',
            state: window.alarmSubscribed ? 0 : 1
        }));
    }
    
    // 更新按钮状态
    if (window.alarmSubscribed) {
        btn.innerHTML = '<i class="fa fa-bell mr-1 text-xs"></i> 订阅报警';
        btn.classList.remove('bg-danger');
        btn.classList.add('bg-success');
        alert('已开启实时报警订阅');
    } else {
        btn.innerHTML = '<i class="fa fa-bell-slash mr-1 text-xs"></i> 取消订阅';
        btn.classList.remove('bg-success');
        btn.classList.add('bg-danger');
        alert('已关闭实时报警订阅');
    }
};

/**
 * 启动MySQL服务器状态检查
 * 功能：检查主备MySQL服务器状态
 */
function startMySQLServersStatusCheck() {
    // 立即检查一次
    checkMySQLStatus();
    
    // 每10秒检查一次
    setInterval(checkMySQLStatus, 10000);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    try {
        console.log('页面加载完成，开始初始化...');
        
        // 权限控制：超级管理员专属功能
        const factoryLevel = localStorage.getItem('factoryLevel');
        const adminMenuGroup = document.getElementById('admin-menu-group');
        
        if (factoryLevel === '99' && adminMenuGroup) {
            // 超级管理员，显示系统管理菜单
            adminMenuGroup.style.display = 'block';
        }
        
        // 更新系统时间
        updateSystemTime();
        setInterval(updateSystemTime, 1000);
        
        // 初始化MySQL配置表单
        initMySQLConfigForm();
        
        // 初始化配置标签切换
        initConfigTabSwitching();
        
        // 启动MySQL服务器状态检查（主备服务器）
        startMySQLServersStatusCheck();
        
        // 初始化事件监听器
        initEventListeners();
        
        // 初始化搜索输入框回车事件
        const initSearchFunctionality = function() {
            const deviceSearchInput = document.getElementById('device-search');
            const alarmDeviceSearchInput = document.getElementById('alarm-device-search');
            
            console.log('初始化搜索功能...');
            console.log('deviceSearchInput元素:', deviceSearchInput);
            
            // 搜索函数
            const handleSearch = function() {
                console.log('执行搜索...');
                // 直接从window对象获取searchDevices函数
                if (typeof window.searchDevices === 'function') {
                    window.searchDevices();
                } else {
                    console.error('searchDevices函数未定义');
                }
            };
            
            // 报警搜索函数
            const handleAlarmSearch = function() {
                console.log('执行报警搜索...');
                // 直接从window对象获取searchAlarmDevices函数
                if (typeof window.searchAlarmDevices === 'function') {
                    window.searchAlarmDevices();
                } else {
                    console.error('searchAlarmDevices函数未定义');
                }
            };
            
            // 添加搜索输入框回车事件
            if (deviceSearchInput) {
                console.log('添加搜索输入框回车事件...');
                deviceSearchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleSearch();
                    }
                });
            }
            
            // 添加报警搜索输入框回车事件
            if (alarmDeviceSearchInput) {
                console.log('添加报警搜索输入框回车事件...');
                alarmDeviceSearchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleAlarmSearch();
                    }
                });
            }
        };
        
        // 延迟初始化搜索功能，确保所有脚本都已加载
        setTimeout(initSearchFunctionality, 500);
        
        // 初始化登录功能
        initLoginFunctionality();
        
        // 检查是否已登录
        checkLoginStatus();
        
        // 设置默认时间值
        setDefaultTimeValues();
        
        // 初始化综合概况页面
        initOverviewPage();
        
        // 设备信息由device-data.js自动获取，这里直接连接MQTT
setTimeout(() => {
    connectMQTT();
}, 500);
        
        // 定期从后端更新设备信息，确保量程信息保持最新
        setInterval(function() {
            console.log('定期从后端更新设备信息...');
            fetchDevicesFromBackend();
        }, 5 * 60 * 1000); // 每5分钟更新一次
        
        // 初始化表格列宽调整功能
        setTimeout(function() {
            console.log('页面加载完成，初始化表格列宽调整功能...');
            initTableResizing();
        }, 1500);
        
        // 监听窗口大小变化，调整图表大小
        window.addEventListener('resize', function() {
            if (window.historyChart) {
                window.historyChart.resize();
                console.log('窗口大小变化，调整图表大小');
            }
        });
        
        // 监听浏览器关闭事件，自动清除登录状态
        window.addEventListener('beforeunload', function() {
            console.log('浏览器关闭，清除登录状态...');
            localStorage.removeItem('token');
            localStorage.removeItem('userRole');
            localStorage.removeItem('loginUser');
        });
        
    } catch (error) {
        console.error('页面初始化错误:', error);
    }
});

/**
 * 初始化MySQL配置表单
 * 功能：初始化MySQL配置表单字段
 */
function initMySQLConfigForm() {
    // 不再初始化MySQL配置表单，因为这些配置应该在后端管理
    // 前端不应该知道或修改MySQL连接信息
    console.log('MySQL配置由后端管理，前端无需配置');
}

/**
 * 初始化配置标签切换
 * 功能：实现配置页面标签切换
 */
function initConfigTabSwitching() {
    const mqttTab = document.getElementById('mqtt-tab');
    const mysqlTab = document.getElementById('mysql-tab');
    const userTab = document.getElementById('user-tab');
    const mqttConfig = document.getElementById('mqtt-config');
    const mysqlConfigForm = document.getElementById('mysql-config');
    const userConfig = document.getElementById('user-config');
    
    if (mqttTab && mysqlTab && userTab && mqttConfig && mysqlConfigForm && userConfig) {
        mqttTab.addEventListener('click', function() {
            // 激活MQTT标签
            mqttTab.classList.add('border-primary', 'text-primary');
            mqttTab.classList.remove('border-transparent', 'text-gray-500');
            
            // 取消激活其他标签
            mysqlTab.classList.add('border-transparent', 'text-gray-500');
            mysqlTab.classList.remove('border-primary', 'text-primary');
            userTab.classList.add('border-transparent', 'text-gray-500');
            userTab.classList.remove('border-primary', 'text-primary');
            
            // 显示MQTT配置，隐藏其他配置
            mqttConfig.classList.remove('hidden');
            mysqlConfigForm.classList.add('hidden');
            userConfig.classList.add('hidden');
        });
        
        mysqlTab.addEventListener('click', function() {
            // 激活MySQL标签
            mysqlTab.classList.add('border-primary', 'text-primary');
            mysqlTab.classList.remove('border-transparent', 'text-gray-500');
            
            // 取消激活其他标签
            mqttTab.classList.add('border-transparent', 'text-gray-500');
            mqttTab.classList.remove('border-primary', 'text-primary');
            userTab.classList.add('border-transparent', 'text-gray-500');
            userTab.classList.remove('border-primary', 'text-primary');
            
            // 显示MySQL配置，隐藏其他配置
            mysqlConfigForm.classList.remove('hidden');
            mqttConfig.classList.add('hidden');
            userConfig.classList.add('hidden');
        });
        
        userTab.addEventListener('click', function() {
            // 激活用户管理标签
            userTab.classList.add('border-primary', 'text-primary');
            userTab.classList.remove('border-transparent', 'text-gray-500');
            
            // 取消激活其他标签
            mqttTab.classList.add('border-transparent', 'text-gray-500');
            mqttTab.classList.remove('border-primary', 'text-primary');
            mysqlTab.classList.add('border-transparent', 'text-gray-500');
            mysqlTab.classList.remove('border-primary', 'text-primary');
            
            // 显示用户管理配置，隐藏其他配置
            userConfig.classList.remove('hidden');
            mqttConfig.classList.add('hidden');
            mysqlConfigForm.classList.add('hidden');
        });
    }
}
