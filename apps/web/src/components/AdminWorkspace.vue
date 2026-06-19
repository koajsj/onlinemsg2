<script setup>
import { formatDateTime, getOnlineLabel } from '../lib/ui.js';

defineProps({
  open: {
    type: Boolean,
    required: true
  },
  loading: {
    type: Boolean,
    required: true
  },
  feedback: {
    type: Object,
    required: true
  },
  summary: {
    type: Object,
    default: null
  },
  users: {
    type: Array,
    required: true
  },
  logins: {
    type: Array,
    required: true
  },
  security: {
    type: Array,
    required: true
  },
  system: {
    type: Object,
    default: null
  },
  onlineStateValue: {
    type: [String, Number],
    required: true
  }
});

defineEmits(['close', 'refresh']);
</script>

<template>
  <div v-if="open" class="workspace-shell">
    <div class="workspace-frame">
      <div class="workspace-head">
        <div>
          <p class="pane-label">后台工作区</p>
          <h2>管理员控制台</h2>
          <p class="pane-copy">统一查看用户、登录、安全事件和当前服务状态。</p>
        </div>
        <div class="workspace-actions">
          <button class="secondary-button" type="button" @click="$emit('refresh')">刷新数据</button>
          <button class="ghost-button" type="button" @click="$emit('close')">关闭</button>
        </div>
      </div>

      <div v-if="feedback.text" class="workspace-banner" :class="`is-${feedback.tone}`">
        {{ feedback.text }}
      </div>

      <div v-if="loading" class="workspace-empty">
        <strong>后台数据加载中</strong>
        <p>正在读取用户、登录日志和系统状态。</p>
      </div>

      <template v-else>
        <div class="admin-grid">
          <div class="metric-card">
            <span>用户总数</span>
            <strong>{{ summary?.stats.totalUsers || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span>近期成功登录</span>
            <strong>{{ summary?.stats.recentLoginCount || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span>安全事件</span>
            <strong>{{ summary?.stats.securityEventCount || 0 }}</strong>
          </div>
          <div class="metric-card">
            <span>OpenIM 状态</span>
            <strong>{{ summary?.openim?.ok ? '正常' : '异常' }}</strong>
          </div>
        </div>

        <div class="workspace-columns">
          <section class="workspace-card">
            <div class="section-head">
              <div>
                <p class="section-label">用户</p>
                <h3>账号列表</h3>
              </div>
              <span class="tiny-chip">{{ users.length }} 人</span>
            </div>
            <div class="admin-table">
              <div class="table-head table-head--users">
                <span>账号</span>
                <span>昵称</span>
                <span>在线</span>
                <span>角色</span>
              </div>
              <div v-for="item in users" :key="item.userId" class="table-row table-row--users">
                <span :title="item.username">{{ item.username }}</span>
                <span :title="item.nickname">{{ item.nickname }}</span>
                <span>{{ getOnlineLabel(item.onlineStatus, onlineStateValue) }}</span>
                <span>{{ item.role === 'admin' ? '管理员' : '用户' }}</span>
              </div>
            </div>
          </section>

          <section class="workspace-card">
            <div class="section-head">
              <div>
                <p class="section-label">日志</p>
                <h3>登录日志</h3>
              </div>
            </div>
            <div class="admin-table">
              <div class="table-head table-head--logs">
                <span>账号</span>
                <span>结果</span>
                <span>IP</span>
                <span>浏览器</span>
                <span>时间</span>
              </div>
              <div v-for="item in logins" :key="item.id" class="table-row table-row--logs">
                <span>{{ item.username }}</span>
                <span>{{ item.status }}</span>
                <span>{{ item.ipAddress }}</span>
                <span :title="item.browser">{{ item.browser }}</span>
                <span>{{ formatDateTime(item.createdAt) }}</span>
              </div>
            </div>
          </section>
        </div>

        <div class="workspace-columns workspace-columns--bottom">
          <section class="workspace-card">
            <div class="section-head">
              <div>
                <p class="section-label">安全</p>
                <h3>异常登录与审计</h3>
              </div>
            </div>
            <div class="admin-table">
              <div class="table-head table-head--security">
                <span>事件</span>
                <span>IP</span>
                <span>浏览器</span>
                <span>详情</span>
              </div>
              <div v-for="item in security" :key="item.id" class="table-row table-row--security">
                <span>{{ item.eventType }}</span>
                <span>{{ item.ipAddress }}</span>
                <span :title="item.browser">{{ item.browser }}</span>
                <span class="admin-cell admin-cell--long" :title="item.details">{{ item.details }}</span>
              </div>
            </div>
          </section>

          <section class="workspace-card">
            <div class="section-head">
              <div>
                <p class="section-label">系统</p>
                <h3>基础运维信息</h3>
              </div>
            </div>
            <div class="system-grid">
              <div class="system-item">
                <span>系统版本</span>
                <strong>{{ system?.platform || '暂无' }}</strong>
              </div>
              <div class="system-item">
                <span>Node</span>
                <strong>{{ system?.nodeVersion || '暂无' }}</strong>
              </div>
              <div class="system-item">
                <span>主机</span>
                <strong>{{ system?.hostname || '暂无' }}</strong>
              </div>
              <div class="system-item">
                <span>内存</span>
                <strong>{{ system ? `${system.freeMemoryMb} / ${system.totalMemoryMb} MB` : '暂无' }}</strong>
              </div>
              <div class="system-item">
                <span>CPU</span>
                <strong>{{ system?.cpuModel || '暂无' }}</strong>
              </div>
              <div class="system-item">
                <span>服务状态</span>
                <strong>{{ summary?.openim?.ok ? '运行正常' : '需要检查' }}</strong>
              </div>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>
