use serde::Serialize;
use std::{fmt::Display, path::PathBuf};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoItem {
    key: String,
    zh_name: String,
    en_name: String,
    supported: bool,
    value: String,
}

fn info_item(key: &str, zh_name: &str, supported: bool, value: impl Into<String>) -> InfoItem {
    InfoItem {
        key: key.to_string(),
        zh_name: zh_name.to_string(),
        en_name: key.to_string(),
        supported,
        value: value.into(),
    }
}

fn collect_path<E: Display>(key: &str, zh_name: &str, value: Result<PathBuf, E>) -> InfoItem {
    match value {
        Ok(path) => info_item(key, zh_name, true, path.to_string_lossy().to_string()),
        Err(error) => info_item(key, zh_name, false, format!("不支持或获取失败：{error}")),
    }
}

#[tauri::command]
pub async fn get_webview_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(tauri::webview_version)
        .await
        .map_err(|error| format!("WebView 版本读取任务失败：{error}"))?
        .map_err(|error| format!("WebView 版本读取失败：{error}"))
}

#[cfg(mobile)]
fn unsupported_path(key: &str, zh_name: &str, reason: &str) -> InfoItem {
    info_item(key, zh_name, false, format!("不支持或获取失败：{reason}"))
}

#[tauri::command]
pub fn get_all_paths(app: tauri::AppHandle) -> Vec<InfoItem> {
    let path = app.path();
    let mut items = vec![
        collect_path("appCacheDir", "应用缓存目录", path.app_cache_dir()),
        collect_path("appConfigDir", "应用配置目录", path.app_config_dir()),
        collect_path("appDataDir", "应用数据目录", path.app_data_dir()),
        collect_path(
            "appLocalDataDir",
            "应用本地数据目录",
            path.app_local_data_dir(),
        ),
        collect_path("appLogDir", "应用日志目录", path.app_log_dir()),
        collect_path("audioDir", "音频目录", path.audio_dir()),
        collect_path("cacheDir", "缓存目录", path.cache_dir()),
        collect_path("configDir", "配置目录", path.config_dir()),
        collect_path("dataDir", "数据目录", path.data_dir()),
    ];

    #[cfg(desktop)]
    {
        items.push(collect_path("desktopDir", "桌面目录", path.desktop_dir()));
    }

    #[cfg(mobile)]
    {
        items.push(unsupported_path(
            "desktopDir",
            "桌面目录",
            "当前移动平台不支持",
        ));
    }

    items.push(collect_path("documentDir", "文档目录", path.document_dir()));
    items.push(collect_path("downloadDir", "下载目录", path.download_dir()));

    #[cfg(desktop)]
    {
        items.push(collect_path(
            "executableDir",
            "可执行文件目录",
            path.executable_dir(),
        ));
        items.push(collect_path("fontDir", "字体目录", path.font_dir()));
    }

    #[cfg(mobile)]
    {
        items.push(unsupported_path(
            "executableDir",
            "可执行文件目录",
            "当前移动平台不支持",
        ));
        items.push(unsupported_path(
            "fontDir",
            "字体目录",
            "当前移动平台不支持",
        ));
    }

    items.push(collect_path("homeDir", "用户主目录", path.home_dir()));
    items.push(collect_path(
        "localDataDir",
        "本地数据目录",
        path.local_data_dir(),
    ));
    items.push(collect_path("pictureDir", "图片目录", path.picture_dir()));
    items.push(collect_path("publicDir", "公共目录", path.public_dir()));
    items.push(collect_path(
        "resourceDir",
        "应用资源目录",
        path.resource_dir(),
    ));

    #[cfg(desktop)]
    {
        items.push(collect_path("runtimeDir", "运行时目录", path.runtime_dir()));
    }

    #[cfg(mobile)]
    {
        items.push(unsupported_path(
            "runtimeDir",
            "运行时目录",
            "当前移动平台不支持",
        ));
    }

    items.push(collect_path("tempDir", "临时目录", path.temp_dir()));

    #[cfg(desktop)]
    {
        items.push(collect_path("templateDir", "模板目录", path.template_dir()));
    }

    #[cfg(mobile)]
    {
        items.push(unsupported_path(
            "templateDir",
            "模板目录",
            "当前移动平台不支持",
        ));
    }

    items.push(collect_path("videoDir", "视频目录", path.video_dir()));

    items
}

#[tauri::command]
pub async fn get_all_app_info(app: tauri::AppHandle) -> Vec<InfoItem> {
    let package_info = app.package_info();
    let mut items = vec![
        info_item("getName", "应用名称", true, package_info.name.clone()),
        info_item(
            "getVersion",
            "应用版本",
            true,
            package_info.version.to_string(),
        ),
        info_item("getTauriVersion", "Tauri 版本", true, tauri::VERSION),
        info_item(
            "getIdentifier",
            "应用标识符",
            true,
            app.config().identifier.clone(),
        ),
        info_item(
            "getBundleType",
            "打包类型",
            true,
            tauri::utils::platform::bundle_type()
                .map(|bundle| bundle.to_string())
                .unwrap_or_else(|| "null".to_string()),
        ),
    ];

    #[cfg(target_vendor = "apple")]
    {
        match app.fetch_data_store_identifiers().await {
            Ok(ids) => {
                let ids_json =
                    serde_json::to_string(&ids).unwrap_or_else(|_| "[序列化失败]".to_string());
                items.push(info_item(
                    "fetchDataStoreIdentifiers",
                    "数据存储标识列表",
                    true,
                    format!("{} 项: {}", ids.len(), ids_json),
                ));
            }
            Err(error) => items.push(info_item(
                "fetchDataStoreIdentifiers",
                "数据存储标识列表",
                false,
                format!("不支持或获取失败：{error}"),
            )),
        }
    }

    #[cfg(not(target_vendor = "apple"))]
    {
        items.push(info_item(
            "fetchDataStoreIdentifiers",
            "数据存储标识列表",
            false,
            "不支持或获取失败：当前平台不支持",
        ));
    }

    items
}

#[tauri::command]
pub fn get_all_os_info() -> Vec<InfoItem> {
    let locale = tauri_plugin_os::locale()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "null".to_string());

    vec![
        info_item("arch", "系统架构", true, tauri_plugin_os::arch()),
        info_item(
            "eol",
            "换行标记",
            true,
            if cfg!(windows) { "\\r\\n" } else { "\\n" },
        ),
        info_item(
            "exeExtension",
            "可执行文件扩展名",
            true,
            tauri_plugin_os::exe_extension(),
        ),
        info_item("family", "系统家族", true, tauri_plugin_os::family()),
        info_item("hostname", "主机名", true, tauri_plugin_os::hostname()),
        info_item("locale", "系统语言区域", true, locale),
        info_item("platform", "系统平台", true, tauri_plugin_os::platform()),
        info_item(
            "type",
            "操作系统类型",
            true,
            tauri_plugin_os::type_().to_string(),
        ),
        info_item(
            "version",
            "操作系统版本",
            true,
            tauri_plugin_os::version().to_string(),
        ),
    ]
}
