mod network;
mod settings;
mod signaling;
mod tauri_info;
mod transfer;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_log::TimezoneStrategy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(settings::SettingsState(Mutex::new(
            settings::Settings::default(),
        )))
        .invoke_handler(tauri::generate_handler![
            settings::settings_get_config_file_path,
            settings::settings_load_active,
            settings::settings_save_active,
            signaling::server_start,
            signaling::server_stop,
            signaling::server_status,
            signaling::server_members,
            signaling::config_get,
            signaling::config_set,
            network::network_get_local_ips,
            tauri_info::get_webview_version,
            tauri_info::get_all_paths,
            tauri_info::get_all_app_info,
            tauri_info::get_all_os_info,
            transfer::transfer_get_default_download_dir,
            transfer::transfer_prepare_receive,
            transfer::transfer_append_chunks,
            transfer::transfer_finish_receive,
            transfer::transfer_abort_receive
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .timezone_strategy(TimezoneStrategy::UseLocal)
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let config_path = settings::config_file_path(app.handle())?;
            let state = signaling::AppRuntimeState::new(config_path).map_err(|err| {
                let setup_err: Box<dyn std::error::Error> = std::io::Error::other(err).into();
                tauri::Error::Setup(setup_err.into())
            })?;
            let settings = settings::Settings::from(
                settings::load_app_config(app.handle()).map_err(|err| {
                    let setup_err: Box<dyn std::error::Error> = std::io::Error::other(err).into();
                    tauri::Error::Setup(setup_err.into())
                })?,
            );
            let settings_state = app.state::<settings::SettingsState>();
            let mut guard = settings_state.0.lock().map_err(|_| {
                let setup_err: Box<dyn std::error::Error> =
                    std::io::Error::other("settings lock failed").into();
                tauri::Error::Setup(setup_err.into())
            })?;
            *guard = settings;
            drop(guard);
            app.manage(state);
            app.manage(transfer::TransferState::new());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running shape-voice application");
}
