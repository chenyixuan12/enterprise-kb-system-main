# 企业知识库系统 — 一键启动脚本
# 启动顺序：MongoDB → 安装依赖 → 后端 + 前端

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  企业知识库系统 — 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. 启动 MongoDB（如果未运行）
Write-Host "`n[1/3] 检查 MongoDB 状态..." -ForegroundColor Yellow
$mongoRunning = Get-Process -Name "mongod" -ErrorAction SilentlyContinue
if (-not $mongoRunning) {
    Write-Host "  MongoDB 未运行，尝试启动..." -ForegroundColor Yellow
    try {
        Start-Process "mongod" -ArgumentList "--dbpath", "C:\data\db" -WindowStyle Hidden
        Write-Host "  MongoDB 已启动（默认 dbpath: C:\data\db）" -ForegroundColor Green
    } catch {
        Write-Host "  MongoDB 启动失败，请确保已安装并配置 PATH 环境变量" -ForegroundColor Red
        Write-Host "  如果 MongoDB 已在其他路径运行，请忽略此提示" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MongoDB 已在运行中" -ForegroundColor Green
}

# 2. 安装根目录依赖（concurrently）
Write-Host "`n[2/3] 安装 concurrently..." -ForegroundColor Yellow
npm install --silent
if ($LASTEXITCODE -ne 0) {
    Write-Host "  concurrently 安装失败，请检查网络" -ForegroundColor Red
    exit 1
}
Write-Host "  concurrently 已就绪" -ForegroundColor Green

# 3. 启动后端和前端
Write-Host "`n[3/3] 启动后端 & 前端..." -ForegroundColor Yellow
Write-Host "  后端: http://localhost:3000" -ForegroundColor Blue
Write-Host "  前端: http://localhost:5173" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm run dev
