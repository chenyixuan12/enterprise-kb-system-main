<template>
  <div class="user-manage">
    <div class="page-header">
      <h1 class="page-title">用户管理</h1>
      <el-button type="primary" @click="openCreateDialog">
        <el-icon><Plus /></el-icon>
        新增用户
      </el-button>
    </div>

    <div class="search-bar">
      <el-input v-model="keyword" placeholder="搜索用户名或昵称" :prefix-icon="Search" clearable style="width: 260px" />
      <el-select v-model="role" placeholder="角色筛选" clearable style="width: 160px">
        <el-option label="全部" value="" />
        <el-option label="管理员" value="admin" />
        <el-option label="普通用户" value="user" />
      </el-select>
      <el-select v-model="status" placeholder="状态筛选" clearable style="width: 160px">
        <el-option label="全部" value="" />
        <el-option label="启用" value="active" />
        <el-option label="禁用" value="disabled" />
      </el-select>
      <el-button @click="reload">
        <el-icon><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="table-card">
      <el-table :data="filteredUsers" style="width: 100%">
        <el-table-column prop="username" label="用户名" min-width="180" />
        <el-table-column prop="nickname" label="昵称" min-width="160">
          <template #default="{ row }">{{ row.nickname || '-' }}</template>
        </el-table-column>
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'success'">{{ row.role === 'admin' ? '管理员' : '普通用户' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ row.status === 'active' ? '启用' : '禁用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEditDialog(row)">编辑</el-button>
            <el-button type="warning" link @click="toggleStatus(row)">
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
            <el-button type="danger" link @click="resetPassword(row)">重置密码</el-button>
            <el-button type="danger" link @click="removeUser(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!filteredUsers.length" description="暂无用户数据" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editingUser ? '编辑用户' : '新增用户'" width="520px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="88px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" :placeholder="editingUser ? '留空则不修改' : '默认 123456'" show-password />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.nickname" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { apiFetch } from '../api/http.js';

const keyword = ref('');
const role = ref('');
const status = ref('');
const users = ref([]);
const dialogVisible = ref(false);
const saving = ref(false);
const editingUser = ref(null);
const formRef = ref();

const form = reactive({
  username: '',
  password: '123456',
  nickname: '',
  role: 'user',
  status: 'active'
});

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }]
};

const filteredUsers = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return users.value.filter((item) => {
    const matchedText = !kw || [item.username, item.nickname].some((field) => String(field || '').toLowerCase().includes(kw));
    const matchedRole = !role.value || item.role === role.value;
    const matchedStatus = !status.value || item.status === status.value;
    return matchedText && matchedRole && matchedStatus;
  });
});

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

function resetForm() {
  editingUser.value = null;
  form.username = '';
  form.password = '123456';
  form.nickname = '';
  form.role = 'user';
  form.status = 'active';
  formRef.value?.clearValidate?.();
}

function openCreateDialog() {
  resetForm();
  dialogVisible.value = true;
}

function openEditDialog(row) {
  editingUser.value = row;
  form.username = row.username || '';
  form.password = '';
  form.nickname = row.nickname || '';
  form.role = row.role || 'user';
  form.status = row.status || 'active';
  dialogVisible.value = true;
}

async function reload() {
  try {
    const result = await apiFetch('/users');
    users.value = result.data || [];
  } catch (error) {
    ElMessage.error(error.message || '加载用户列表失败');
  }
}

async function submitForm() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  try {
    saving.value = true;
    const isEdit = Boolean(editingUser.value);
    const payload = {
      username: form.username,
      nickname: form.nickname,
      role: form.role,
      status: form.status
    };
    if (form.password) payload.password = form.password;

    const result = await apiFetch(isEdit ? `/users/${editingUser.value._id}` : '/users', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    ElMessage.success(result.message || '保存成功');
    dialogVisible.value = false;
    await reload();
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function removeUser(row) {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.username}」吗？`, '提示', { type: 'warning' });
    await apiFetch(`/users/${row._id}`, { method: 'DELETE' });
    ElMessage.success('删除成功');
    await reload();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

async function resetPassword(row) {
  try {
    await ElMessageBox.confirm(`确认重置用户「${row.username}」的密码为 123456？`, '提示', { type: 'warning' });
    const result = await apiFetch(`/users/${row._id}/reset-password`, { method: 'PATCH' });
    ElMessage.success(result.message || '密码重置成功');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '重置失败');
    }
  }
}

async function toggleStatus(row) {
  try {
    const nextStatus = row.status === 'active' ? 'disabled' : 'active';
    const result = await apiFetch(`/users/${row._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    ElMessage.success(result.message || '状态更新成功');
    await reload();
  } catch (error) {
    ElMessage.error(error.message || '状态更新失败');
  }
}

onMounted(() => {
  reload();
});
</script>

<style scoped>
.user-manage {
  width: 100%;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}
.search-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.table-card {
  background: #fff;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
</style>
