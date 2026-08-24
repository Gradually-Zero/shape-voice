use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingSettings {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferSettings {
    pub download_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastConnectedSignalingServerSettings {
    pub host: String,
    pub port: String,
    pub protocol: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub signaling: SignalingSettings,
    #[serde(default)]
    pub last_connected_signaling_server: LastConnectedSignalingServerSettings,
    #[serde(default)]
    pub transfer: TransferSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub last_connected_signaling_server: LastConnectedSignalingServerSettings,
    #[serde(default)]
    pub transfer: TransferSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFilePathResult {
    path: Option<String>,
}

pub struct SettingsState(pub Mutex<Settings>);

// Keep this manual default: the local signaling server should be reachable on the LAN by default.
impl Default for SignalingSettings {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 18080,
        }
    }
}

// Keep this manual default: the connect form needs ws/signaling for first-time users.
impl Default for LastConnectedSignalingServerSettings {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: String::new(),
            protocol: "ws".to_string(),
            path: "signaling".to_string(),
        }
    }
}

impl From<AppConfig> for Settings {
    fn from(config: AppConfig) -> Self {
        Self {
            last_connected_signaling_server: config.last_connected_signaling_server,
            transfer: config.transfer,
        }
    }
}

#[tauri::command]
pub fn settings_load_active(
    app: AppHandle,
    state: State<'_, SettingsState>,
) -> Result<Settings, String> {
    let config = load_app_config(&app)?;
    let settings = Settings::from(config);
    let mut guard = state.0.lock().map_err(|_| "settings lock failed")?;
    *guard = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn settings_save_active(
    app: AppHandle,
    settings: Settings,
    state: State<'_, SettingsState>,
) -> Result<(), String> {
    let config_path = config_file_path(&app)?;
    let mut config = load_app_config_from_path(&config_path)?;
    config.last_connected_signaling_server = settings.last_connected_signaling_server.clone();
    config.transfer = settings.transfer.clone();
    write_app_config_file(&config_path, &config)?;

    let mut guard = state.0.lock().map_err(|_| "settings lock failed")?;
    *guard = settings;
    Ok(())
}

#[tauri::command]
pub fn settings_get_config_file_path(app: AppHandle) -> Result<ConfigFilePathResult, String> {
    let path = config_file_path(&app)?;
    let path = if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    };
    Ok(ConfigFilePathResult { path })
}

pub fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

pub fn load_app_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_file_path(app)?;
    load_app_config_from_path(&path)
}

pub fn load_app_config_from_path(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        let fallback = AppConfig::default();
        write_app_config_file(path, &fallback)?;
        return Ok(fallback);
    }

    let raw = fs::read_to_string(path).map_err(|err| format!("read config failed: {err}"))?;
    let config: AppConfig =
        serde_json::from_str(&raw).map_err(|err| format!("parse config failed: {err}"))?;
    Ok(config)
}

pub fn write_app_config_file(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("create config dir failed: {err}"))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|err| format!("serialize config failed: {err}"))?;
    fs::write(path, content).map_err(|err| format!("write config failed: {err}"))?;
    Ok(())
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(mobile)]
    {
        app.path()
            .home_dir()
            .map_err(|err| format!("resolve mobile config dir failed: {err}"))
    }

    #[cfg(not(mobile))]
    {
        app.path()
            .app_config_dir()
            .map_err(|err| format!("resolve desktop config dir failed: {err}"))
    }
}
