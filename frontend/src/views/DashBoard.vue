<template>
  <div class="dashboard">
    <div class="welcome-section">
      <h1>欢迎回来，管理员！</h1>
      <p>今天是 {{ currentDate }}，祝您工作愉快！</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <el-icon :size="28"><User /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.userCount }}</div>
          <div class="stat-label">用户总数</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
          <el-icon :size="28"><Document /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.docCount }}</div>
          <div class="stat-label">文档总数</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);">
          <el-icon :size="28"><ChatDotRound /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.todayQuestions }}</div>
          <div class="stat-label">今日提问</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);">
          <el-icon :size="28"><FolderOpened /></el-icon>
        </div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.categoryCount }}</div>
          <div class="stat-label">知识库数量</div>
        </div>
      </div>
      
    </div>

    <div class="charts-grid">
      <div class="section-card chart-card">
          <div class="card-header">
            <h3>近一周提问趋势</h3>
          </div>
        <div class="card-body chart-container">
          <div ref="trendChartRef" style="width: 100%; height: 300px;"></div>
        </div>
      </div>

      <div class="section-card chart-card">
        <div class="card-header">
          <h3>知识库文档占比</h3>
        </div>
        <div class="card-body chart-container">
          <div ref="pieChartRef" style="width: 100%; height: 300px;"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { User, Document, ChatDotRound, FolderOpened } from '@element-plus/icons-vue'
import { apiFetch } from '../api/http.js'
import * as echarts from 'echarts'

const trendChartRef = ref(null)
const pieChartRef = ref(null)
let trendChart = null
let pieChart = null

const currentDate = computed(() => {
  const now = new Date()
  return now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
})

const stats = ref({
  userCount: 0,
  docCount: 0,
  todayQuestions: 0,
  categoryCount: 0
})

const trendData = ref([])
const categoryData = ref([])

async function loadStats() {
  try {
    const result = await apiFetch('/admin/dashboard')
    if (result && result.data) {
      stats.value = {
        userCount: result.data.userCount || 0,
        docCount: result.data.docCount || 0,
        todayQuestions: result.data.todayQuestions || 0,
        categoryCount: result.data.categoryCount || 0
      }
    }
  } catch (error) {
    console.error('加载统计数据失败:', error)
  }
}

async function loadTrendData() {
  try {
    const result = await apiFetch('/admin/question-trend?days=7')
    if (result && result.data) {
      trendData.value = result.data
      nextTick(() => {
        initTrendChart()
      })
    }
  } catch (error) {
    console.error('加载趋势数据失败:', error)
  }
}

async function loadCategoryData() {
  try {
    const result = await apiFetch('/admin/category-stats')
    if (result && result.data) {
      categoryData.value = result.data
      nextTick(() => {
        initPieChart()
      })
    }
  } catch (error) {
    console.error('加载知识库数据失败:', error)
  }
}

function initTrendChart() {
  if (!trendChartRef.value) return
  
  if (trendChart) {
    trendChart.dispose()
  }
  
  trendChart = echarts.init(trendChartRef.value)
  
  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        lineStyle: {
          color: '#ddd'
        }
      },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e8e8e8',
      borderWidth: 1,
      textStyle: {
        color: '#333'
      },
      formatter: '{b}<br/>提问次数: {c}'
    },
    grid: {
      left: '6%',
      right: '4%',
      top: '10%',
      bottom: '18%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: trendData.value.map(item => {
        const date = item.date.split('-')
        return `${date[1]}-${date[2]}`
      }),
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: '#e8e8e8'
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        fontSize: 12,
        color: '#6b7280'
      }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        fontSize: 12,
        color: '#6b7280'
      },
      splitLine: {
        lineStyle: {
          color: '#f0f0f0',
          type: 'dashed'
        }
      }
    },
    series: [
      {
        name: '提问次数',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: trendData.value.map(item => item.count),
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(103, 126, 234, 0.4)' },
            { offset: 1, color: 'rgba(103, 126, 234, 0.05)' }
          ])
        },
        lineStyle: {
          color: '#667eea',
          width: 2.5
        },
        itemStyle: {
          color: '#667eea',
          borderColor: '#fff',
          borderWidth: 2
        },
        emphasis: {
          itemStyle: {
            symbolSize: 10,
            borderWidth: 3
          }
        }
      }
    ]
  }
  
  trendChart.setOption(option)
}

function initPieChart() {
  if (!pieChartRef.value) return
  
  if (pieChart) {
    pieChart.dispose()
  }
  
  pieChart = echarts.init(pieChartRef.value)
  
  const colors = [
    '#667eea',
    '#f093fb',
    '#4facfe',
    '#43e97b',
    '#fa709a',
    '#fee140',
    '#a855f7',
    '#3b82f6'
  ]
  
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'horizontal',
      bottom: '5%',
      left: 'center',
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 20,
      textStyle: {
        fontSize: 12,
        color: '#6b7280'
      }
    },
    series: [
      {
        name: '文档数量',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '40%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#fff',
          borderWidth: 3
        },
        label: {
          show: false
        },
        labelLine: {
          show: false
        },
        emphasis: {
          scale: true,
          scaleSize: 8,
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold',
            formatter: '{b}\n{c} 篇'
          },
          labelLine: {
            show: true,
            length: 15,
            length2: 10
          }
        },
        data: categoryData.value.map((item, index) => ({
          name: item.name,
          value: item.value,
          itemStyle: {
            color: colors[index % colors.length]
          }
        }))
      }
    ]
  }
  
  pieChart.setOption(option)
}

onMounted(() => {
  loadStats()
  loadTrendData()
  loadCategoryData()
  
  // 监听窗口变化，自动调整图表大小
  window.addEventListener('resize', () => {
    if (trendChart) trendChart.resize()
    if (pieChart) pieChart.resize()
  })
})
</script>

<style lang="scss" scoped>
.dashboard {
  width: 100%;
  
  .welcome-section {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 32px;
    border-radius: 12px;
    margin-bottom: 24px;
    
    h1 {
      color: #ffffff;
      font-size: 28px;
      margin: 0 0 8px 0;
    }
    
    p {
      color: rgba(255, 255, 255, 0.85);
      font-size: 16px;
      margin: 0;
    }
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
    
    .stat-card {
      background: #ffffff;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
      display: flex;
      align-items: center;
      gap: 20px;
      
      .stat-icon {
        width: 60px;
        height: 60px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
      }
      
      .stat-content {
        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: #1f2937;
          line-height: 1.2;
        }
        
        .stat-label {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }
      }
    }
  }

  .charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
    
    .chart-card {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      
      .card-header {
        padding: 16px 20px;
        border-bottom: 1px solid #f0f0f0;
        
        h3 {
          font-size: 16px;
          font-weight: 600;
          color: #303133;
          margin: 0;
        }
      }
      
      .card-body {
        padding: 16px;
      }
      
      .chart-container {
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }
  }
}
</style>
