<template>
    <div>
        <PageHead>
            <template #buttons>
                <el-button type="primary" @click="handleEdit({})">新增知识库</el-button>
            </template>
        </PageHead>
        <TableSearch :formItem="formItem" @search="handleSearch"/>
        <el-table :data="tableData" style="width:100%;margin-top: 25px;">
          <el-table-column type="index" label="ID" width="50" fixed="left" />
            <el-table-column label="知识库名称" width="200px">
                <template #default="scope">
                    <div style="display:flex;align-items:center">
                        <span>{{scope.row.name}}</span>
                    </div>
                </template>
            </el-table-column>
           <el-table-column prop="description" label="描述" width="350px"/> 
          <el-table-column label="文档数" width="100px">
            <template #default="scope">
              <el-tag type="info" size="small">{{ scope.row.docCount || 0 }}篇</el-tag>
            </template>
          </el-table-column> 
            <el-table-column prop="status" label="状态" width="100px">
              <template #default="scope">
                <el-tag :type="scope.row.status === 'active' ? 'success' : 'warning'">
                  {{ scope.row.status === 'active' ? '可用' : '不可用' }}
                </el-tag>
              </template>
            </el-table-column>
            
            <el-table-column label="创建时间" width="120px">
              <template #default="scope">
                {{ formatDate(scope.row.createTime) }}
              </template>
            </el-table-column>
            
            <el-table-column  label="操作" width="240px" fixed="right">
                <template #default="scope">
                    <el-button text @click="handleEdit(scope.row)" type="primary">编辑</el-button>
                   <el-button text @click="handleDelete(scope.row)" type="danger">删除</el-button>
                </template>
            </el-table-column>
        </el-table>
         <el-pagination
    :page-size="pagination.size"
    background-color="#f5f7fa"
    layout="prev, pager, next"
    :total="pagination.total"
    @current-change="handleChange"
  />
  
  <!-- 新增知识库弹窗 -->
  <el-dialog 
    v-model="dialogVisible" 
    :title="isEdit ? '编辑知识库' : '新增知识库'" 
    width="500px"
    @closed="resetForm"
  >
    <el-form :model="knowledgeForm" :rules="formRules" ref="formRef" label-width="100px">
      <el-form-item label="知识库名称" prop="name">
        <el-input 
          v-model="knowledgeForm.name" 
          placeholder="请输入知识库名称"
          maxlength="50"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input 
          v-model="knowledgeForm.description" 
          type="textarea"
          :rows="4"
          placeholder="请输入知识库描述"
          maxlength="200"
          show-word-limit
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
    </div>
</template>
<script setup>
import { onMounted, ref, reactive } from 'vue'
import PageHead from "../components/PageHead.vue"
import TableSearch from "../components/TableSearch.vue"
import { ElMessage, ElMessageBox } from 'element-plus'
import { http } from "../api/http.js"


const formRef = ref(null)
const isEdit = ref(false)
const knowledgeForm = reactive({
  name: '',
  description: ''
})
const formRules = {
  name: [
    { required: true, message: '请输入知识库名称', trigger: 'blur' },
    { min: 2, max: 50, message: '长度在 2 到 50 个字符', trigger: 'blur' }
  ]
}

function resetForm() {
  knowledgeForm.name = ''
  knowledgeForm.description = ''
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function handleSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()

    if (isEdit.value) {
      await http.put(`/category/${currentArticle.value?._id}`, {
        name: knowledgeForm.name,
        description: knowledgeForm.description
      })
      ElMessage.success('编辑成功')
    } else {
      await http.post('/category', {
        name: knowledgeForm.name,
        description: knowledgeForm.description
      })
      ElMessage.success('新增成功')
    }

    dialogVisible.value = false
    handleSearch(lastQuery.value)
  } catch (error) {
    console.log('提交失败', error)
    ElMessage.error(error.message || '操作失败，请重试')
  }
}



//分页参数
const pagination = reactive({
    currentPage:1,//当前页码
    size:10,//每页条数
    total:0//总条数
})
//获取调用接口的列表数据
const tableData = ref([])
const lastQuery = ref({})
//要给TableSearch子组件传递的表单项
const formItem = [
    {
        comp:'input',
        label:'知识库名称',
        prop:'title',
        placeholder:'请输入知识库名称'
    }

]
//新增和编辑
const dialogVisible = ref(false)
//在TableSearch组件中调用，拿到formdata表单的结果再返回给组件
async function handleSearch(formData){
    console.log(formData,'查询参数')
    lastQuery.value = formData || {}
    
    const params = {
      ...(formData || {}),
      page: pagination.currentPage,
      pageSize: pagination.size
    }

    const result = await http.get('/category', { params })
    const data = result?.data?.data

    if (data) {
      tableData.value = data.list || data || []
      pagination.total = data.total || 0
    } else {
      tableData.value = []
      pagination.total = 0
    }
}

onMounted(() => {
   handleSearch({})
})
function handleChange(page){
    pagination.currentPage = page
    handleSearch(lastQuery.value)
}
const currentArticle = ref(null)
const handleEdit=(row)=>{
    if(!row._id) {
        isEdit.value = false
        resetForm()
        dialogVisible.value = true
    }else{
        isEdit.value = true
        knowledgeForm.name = row.name || ''
        knowledgeForm.description = row.description || ''
        currentArticle.value = row
        dialogVisible.value = true
    }
}


const handleDelete=(row)=>{
    ElMessageBox.confirm(
        `确认删除知识库「${row.name}」吗？`,
        '确认',
        {
            confirmButtonText: '确认删除',
            cancelButtonText: '取消',
            type: 'danger'
        }
    ).then(async ()=>{
        await http.delete(`/category/${row._id}`)
        ElMessage.success('删除成功')
        handleSearch(lastQuery.value)
    }).catch(() => {
        ElMessage.info('已取消删除')
    })
}
</script>
