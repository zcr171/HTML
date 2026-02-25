// 图表相关功能
let deviceStatusChart = null;
let alarmTypeChart = null;

/**
 * 初始化综合概况页面图表
 * 功能：初始化综合概况页面的设备状态分布和报警类型分布图表
 */
function initOverviewPage() {
    initDeviceStatusChart();
    initAlarmTypeChart();
}

/**
 * 初始化设备状态分布图表
 * 功能：创建设备状态分布饼图
 */
function initDeviceStatusChart() {
    try {
        const ctx = document.getElementById('device-status-chart');
        if (!ctx) return;
        
        // 销毁现有图表
        if (deviceStatusChart) {
            deviceStatusChart.destroy();
        }
        
        // 模拟设备状态数据
        const totalDevices = Object.keys(deviceData).length;
        const onlineDevices = totalDevices;
        const offlineDevices = 0;
        const alarmDevices = alarmData.length;
        
        // 创建图表
        deviceStatusChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['在线设备', '离线设备', '报警设备'],
                datasets: [{
                    data: [onlineDevices, offlineDevices, alarmDevices],
                    backgroundColor: [
                        '#10b981', // 绿色 - 在线
                        '#6b7280', // 灰色 - 离线
                        '#f59e0b'  // 黄色 - 报警
                    ],
                    borderColor: [
                        '#059669',
                        '#4b5563',
                        '#d97706'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 12
                            },
                            padding: 20
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.raw || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('初始化设备状态分布图表时出错:', error);
    }
}

/**
 * 初始化报警类型分布图表
 * 功能：创建报警类型分布柱状图
 */
function initAlarmTypeChart() {
    try {
        const ctx = document.getElementById('alarm-type-chart');
        if (!ctx) return;
        
        // 销毁现有图表
        if (alarmTypeChart) {
            alarmTypeChart.destroy();
        }
        
        // 统计报警类型
        const alarmTypeCount = {};
        alarmData.forEach(alarm => {
            if (alarm.type) {
                alarmTypeCount[alarm.type] = (alarmTypeCount[alarm.type] || 0) + 1;
            }
        });
        
        // 准备图表数据
        const labels = Object.keys(alarmTypeCount);
        const data = Object.values(alarmTypeCount);
        
        // 如果没有报警数据，使用默认数据
        if (labels.length === 0) {
            labels.push('无报警');
            data.push(0);
        }
        
        // 创建图表
        alarmTypeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '报警数量',
                    data: data,
                    backgroundColor: '#0ea5e9',
                    borderColor: '#0284c7',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `报警数量: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('初始化报警类型分布图表时出错:', error);
    }
}

/**
 * 更新图表数据
 * 功能：更新所有图表的数据
 */
function updateCharts() {
    initDeviceStatusChart();
    initAlarmTypeChart();
}
