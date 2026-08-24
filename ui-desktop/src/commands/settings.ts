import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface LastConnectedSignalingServer {
  host: string;
  port: string;
  path: string;
  protocol: string;
}

interface Transfer {
  downloadDir: string;
}

export interface Settings {
  lastConnectedSignalingServer: LastConnectedSignalingServer;
  transfer: Transfer;
}

export function getConfigFilePath() {
  return invoke<{ path: string | null }>('settings_get_config_file_path');
}

export function loadActive() {
  return invoke<Settings>('settings_load_active');
}

export function saveActive(settings: Settings) {
  return invoke<void>('settings_save_active', { settings });
}

export async function pickDownloadDir() {
  const picked = await open({
    directory: true,
    multiple: false,
    title: '选择下载目录',
  });
  return typeof picked === 'string' ? picked : null;
}
