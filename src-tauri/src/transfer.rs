use crate::settings::SettingsState;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
#[cfg(mobile)]
use std::path::Component;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

struct ReceiveFile {
    file: File,
    path: PathBuf,
    expected_size: u64,
    written: u64,
}

pub struct TransferState(Mutex<HashMap<String, ReceiveFile>>);

impl TransferState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReceiveResult {
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendChunkResult {
    written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishReceiveResult {
    path: String,
    written: u64,
    expected_size: u64,
}

#[tauri::command]
pub fn transfer_get_default_download_dir(app: AppHandle) -> Result<String, String> {
    Ok(default_receive_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn transfer_prepare_receive(
    app: AppHandle,
    file_id: String,
    name: String,
    size: u64,
    state: State<'_, TransferState>,
    settings_state: State<'_, SettingsState>,
) -> Result<PrepareReceiveResult, String> {
    if file_id.trim().is_empty() {
        return Err("file_id required".to_string());
    }
    if name.trim().is_empty() {
        return Err("file name required".to_string());
    }

    {
        let map = state.0.lock().map_err(|_| "transfer lock failed")?;
        if map.contains_key(&file_id) {
            return Err(format!("receive task already exists: {file_id}"));
        }
    }

    let configured_dir = {
        let guard = settings_state
            .0
            .lock()
            .map_err(|_| "settings lock failed")?;
        guard.transfer.download_dir.trim().to_string()
    };
    let target_dir = resolve_target_dir(&app, &configured_dir)?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("create output dir failed: {err}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let file_path = target_dir.join(format!("{ts}-{}", sanitize_name(&name)));
    let file = File::create(&file_path).map_err(|err| format!("create file failed: {err}"))?;

    let mut map = state.0.lock().map_err(|_| "transfer lock failed")?;
    map.insert(
        file_id,
        ReceiveFile {
            file,
            path: file_path.clone(),
            expected_size: size,
            written: 0,
        },
    );

    Ok(PrepareReceiveResult {
        path: file_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn transfer_append_chunks(
    file_id: String,
    chunks: Vec<Vec<u8>>,
    state: State<'_, TransferState>,
) -> Result<AppendChunkResult, String> {
    let mut map = state.0.lock().map_err(|_| "transfer lock failed")?;
    let entry = map
        .get_mut(&file_id)
        .ok_or_else(|| format!("receive task not found: {file_id}"))?;

    for chunk in chunks {
        entry
            .file
            .write_all(&chunk)
            .map_err(|err| format!("append chunk failed: {err}"))?;
        entry.written += chunk.len() as u64;
    }

    Ok(AppendChunkResult {
        written: entry.written,
    })
}

#[tauri::command]
pub fn transfer_finish_receive(
    file_id: String,
    state: State<'_, TransferState>,
) -> Result<FinishReceiveResult, String> {
    let mut map = state.0.lock().map_err(|_| "transfer lock failed")?;
    let mut entry = map
        .remove(&file_id)
        .ok_or_else(|| format!("receive task not found: {file_id}"))?;

    entry
        .file
        .flush()
        .map_err(|err| format!("flush file failed: {err}"))?;
    if entry.written != entry.expected_size {
        let _ = fs::remove_file(&entry.path);
        return Err(format!(
            "received size mismatch: written={} expected={}",
            entry.written, entry.expected_size
        ));
    }

    Ok(FinishReceiveResult {
        path: entry.path.to_string_lossy().to_string(),
        written: entry.written,
        expected_size: entry.expected_size,
    })
}

#[tauri::command]
pub fn transfer_abort_receive(
    file_id: String,
    state: State<'_, TransferState>,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "transfer lock failed")?;
    if let Some(entry) = map.remove(&file_id) {
        let _ = fs::remove_file(entry.path);
    }
    Ok(())
}

fn default_receive_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = resolve_default_output_dir(app)?;
    Ok(base_dir.join("shape-voice-received"))
}

fn resolve_default_output_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(mobile)]
    {
        // 移动端仅使用用户主目录；无法解析时直接失败，不做回退。
        app.path()
            .home_dir()
            .map_err(|err| format!("resolve mobile home dir failed: {err}"))
    }

    #[cfg(not(mobile))]
    {
        app.path()
            .download_dir()
            .map_err(|err| format!("resolve desktop output dir failed: {err}"))
    }
}

fn resolve_target_dir(app: &AppHandle, configured_dir: &str) -> Result<PathBuf, String> {
    if configured_dir.is_empty() {
        return default_receive_dir(app);
    }

    #[cfg(mobile)]
    {
        let home_dir = resolve_default_output_dir(app)?;
        let configured_path = PathBuf::from(configured_dir);
        if configured_path.is_absolute() {
            return Err("mobile download_dir must be a relative path under home_dir".to_string());
        }
        if configured_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err("mobile download_dir must stay within home_dir".to_string());
        }
        Ok(home_dir.join(configured_path))
    }

    #[cfg(not(mobile))]
    {
        Ok(PathBuf::from(configured_dir))
    }
}

fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect()
}
