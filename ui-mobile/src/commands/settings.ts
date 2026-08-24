import { invoke } from '@tauri-apps/api/core';

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
