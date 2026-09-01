import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import BackendLayout from '../components/BackendLayout.vue';
import AdminView from '../views/AdminView.vue';
import QaView from '../views/QaView.vue';
import ChatHomeView from '../views/ChatHomeView.vue';
import DocumentManageView from '../views/DocumentManageView.vue';
import KnowledgeDB from '../views/KnowledgeDB.vue';
import DashBoard from '../views/DashBoard.vue';
import UsersView from '../views/Users.vue';
import ChatHistoryView from '../views/ChatHistoryView.vue';
import { clearAuth, getStoredUser } from '../utils/auth.js';

const routes = [
  { path: '/', component: LoginView },
  {
    path: '/backend',
    component: BackendLayout,
    redirect: '/backend/dashboard',
    children: [
      { path: 'home', component: ChatHomeView },
      { path: 'admin', component: AdminView },
      { path: 'documents', component: DocumentManageView },
      { path: 'qa', component: QaView },
      { path: 'konwledgedb', component: KnowledgeDB },
      { path: 'dashboard', component: DashBoard },
      { path: 'users', component: UsersView },
      { path: 'chatHistory', component: ChatHistoryView },
    ]
  },

  // 兼容旧路由与直接访问，避免页面空白
  { path: '/admin', redirect: '/backend/admin' },
  { path: '/documents', redirect: '/backend/documents' },
  { path: '/qa', redirect: '/backend/qa' },
  { path: '/dashboard', redirect: '/backend/dashboard' },
  { path: '/home', redirect: '/backend/home' },
  { path: '/users', redirect: '/backend/users' },
  { path: '/dialog', redirect: '/backend/dialog' },
  { path: '/konwledgedb', redirect: '/backend/konwledgedb' }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to) => {
  const user = getStoredUser();
  if (!user && to.path !== '/') {
    clearAuth();
    return '/';
  }
  return true;
});

export default router;
