const { contextBridge, ipcRenderer, webUtils } = require('electron');

const subscribe = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.off(channel, fn);
};

contextBridge.exposeInMainWorld('micme', {
  getInfo: () => ipcRenderer.invoke('micme:info'),
  newCode: () => ipcRenderer.invoke('micme:new-code'),
  refreshNetwork: () => ipcRenderer.invoke('micme:refresh-network'),
  saveRecording: (bytes, ext) => ipcRenderer.invoke('micme:save-recording', bytes, ext),
  sendFiles: (paths) => ipcRenderer.invoke('micme:send-files', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openDownloads: () => ipcRenderer.invoke('micme:open-downloads'),
  showFile: (file) => ipcRenderer.invoke('micme:show-file', file),
  openExternal: (url) => ipcRenderer.invoke('micme:open-external', url),
  setAlwaysOnTop: (on) => ipcRenderer.invoke('micme:always-on-top', on),
  onInfo: subscribe('micme:info'),
  onTransfer: subscribe('micme:transfer'),
});
