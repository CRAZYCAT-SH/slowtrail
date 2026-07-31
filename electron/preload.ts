import { contextBridge } from 'electron';

// 暴露给渲染进程的 API（按需扩展）
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
