<template>
  <el-form :model="formData" ref="ruleFormRef">
    <el-row :gutter="24">
      <template v-for="item in formItemAttars" :key="item.prop">
        <el-col v-bind="item.col">
          <el-form-item :label="item.label" :prop="item.prop">
            <component 
              v-model="formData[item.prop]" 
              :is="isComp(item.comp)" 
              :placeholder="item.placeholder"
            >
              <el-option 
                v-for="opt in item.options" 
                :key="opt.value" 
                :value="opt.value" 
                :label="opt.label" 
              />
            </component>
          </el-form-item>
        </el-col>
      </template>
    </el-row>
    <el-button type="primary" @click="handleSearch">查询</el-button>
    <el-button type="reset" @click="handleReset(ruleFormRef)">重置</el-button>
  </el-form>
</template>

<script setup name="TableSearch">
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'

const ruleFormRef = ref()

const formData = reactive({})

const props = defineProps({
  formItem: {
    type: Array,
    default: () => []
  }
})

// 初始化formData字段
props.formItem.forEach(item => {
  formData[item.prop] = ''
})

const formItemAttars = computed(() => {
  const { formItem } = props
  formItem.forEach(item => {
    item.col = item.col || { xs: 24, sm: 12, md: 8, lg: 6, xl: 6 }
  })
  return formItem
})

function isComp(comp) {
  return {
    input: 'el-input',
    select: 'el-select'
  }[comp]
}

const emit = defineEmits(['search'])

function handleSearch() {
  // 清理空值参数，只传递有值的字段
  const params = {}
  Object.keys(formData).forEach(key => {
    const value = formData[key]
    if (value !== undefined && value !== null && value !== '') {
      params[key] = value
    }
  })
  
  emit('search', params)
}

function handleReset(formEl) {
  if (!formEl) return
  formEl.resetFields()
  
  // 重置formData为空对象
  Object.keys(formData).forEach(key => {
    formData[key] = ''
  })
  
  emit('search', {})
  ElMessage.success('筛选条件已重置')
}
</script>

<style scoped>
</style>
