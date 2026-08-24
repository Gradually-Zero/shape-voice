import { invoke } from '@tauri-apps/api/core';

interface ReceivedFileInfo {
  path: string;
  written: number;
  expectedSize: number;
}

export function getDefaultDownloadDir() {
  return invoke<string>('transfer_get_default_download_dir');
}

export function prepareReceive(fileId: string, name: string, size: number) {
  return invoke<{ path: string }>('transfer_prepare_receive', {
    fileId,
    name,
    size,
  });
}

export function appendChunks(fileId: string, chunks: Uint8Array[]) {
  return invoke<{ written: number }>('transfer_append_chunks', {
    fileId,
    chunks: chunks.map((chunk) => Array.from(chunk)),
  });
}

export function finishReceive(fileId: string) {
  return invoke<ReceivedFileInfo>('transfer_finish_receive', { fileId });
}

export function abortReceive(fileId: string) {
  return invoke<void>('transfer_abort_receive', { fileId });
}
