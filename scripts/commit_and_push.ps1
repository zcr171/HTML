<#
.SYNOPSIS
自动保存脚本 - 定期检测文件变化并提交到GitHub

.DESCRIPTION
此脚本会：
1. 定期检查文件变化
2. 自动添加所有修改的文件
3. 提交带有时间戳的消息
4. 推送到GitHub仓库
5. 持续运行，直到手动停止

.EXAMPLE
# 启动自动保存
./commit_and_push.ps1

# 按 Ctrl+C 停止脚本
#>

Write-Host "=== 自动保存脚本启动 ===" -ForegroundColor Green
Write-Host "定期检测文件变化并提交到GitHub仓库"
Write-Host "按 Ctrl+C 停止脚本"
Write-Host "=========================" -ForegroundColor Green
Write-Host ""

# 设置检测间隔（秒）
$interval = 300  # 5分钟

# 持续运行
while ($true) {
    try {
        # 检查是否有未提交的更改
        $changes = git status --porcelain
        
        if ($changes) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 检测到文件变化，开始提交..." -ForegroundColor Yellow
            
            # 添加所有更改
            git add .
            
            # 生成带有时间戳的提交消息
            $commitMessage = "自动保存: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            
            # 提交更改
            git commit -m $commitMessage
            
            # 推送到GitHub
            git push origin main
            
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 提交成功！" -ForegroundColor Green
        } else {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 无文件变化，等待下一次检查..." -ForegroundColor Gray
        }
    } catch {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 错误: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # 等待指定的间隔时间
    Write-Host "等待 $interval 秒后再次检查..."
    Start-Sleep -Seconds $interval
    Write-Host ""
}