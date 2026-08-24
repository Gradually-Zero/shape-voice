use crate::settings::{self, SignalingSettings};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State as AxumState,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot, Mutex, RwLock as AsyncRwLock},
};

const MEMBERS_CHANGED_EVENT: &str = "signaling-members-changed";
static NEXT_CLIENT_ID: AtomicU64 = AtomicU64::new(1);

pub type AppConfig = SignalingSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    running: bool,
    host: Option<String>,
    port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdate {
    host: String,
    port: u16,
}

struct ConfigManager {
    path: PathBuf,
    current: RwLock<AppConfig>,
}

impl ConfigManager {
    fn new(path: PathBuf) -> Result<Self, String> {
        let mut app_config = settings::load_app_config_from_path(&path).unwrap_or_default();

        if validate_config(&app_config.signaling).is_err() {
            app_config.signaling = AppConfig::default();
        }
        settings::write_app_config_file(&path, &app_config)?;
        let config = app_config.signaling;

        Ok(Self {
            path,
            current: RwLock::new(config),
        })
    }

    fn get(&self) -> AppConfig {
        self.current
            .read()
            .expect("config read lock poisoned")
            .clone()
    }

    fn set(&self, next: AppConfig) -> Result<(), String> {
        validate_config(&next)?;
        let mut app_config = settings::load_app_config_from_path(&self.path)
            .unwrap_or_else(|_| settings::AppConfig::default());
        app_config.signaling = next.clone();
        settings::write_app_config_file(&self.path, &app_config)?;
        let mut guard = self.current.write().expect("config write lock poisoned");
        *guard = next;
        Ok(())
    }
}

struct RunningServer {
    host: String,
    port: u16,
    relay_state: RelayState,
    shutdown_tx: oneshot::Sender<()>,
    task: tauri::async_runtime::JoinHandle<()>,
}

pub struct AppRuntimeState {
    config: ConfigManager,
    server: Mutex<Option<RunningServer>>,
}

impl AppRuntimeState {
    pub fn new(config_path: PathBuf) -> Result<Self, String> {
        Ok(Self {
            config: ConfigManager::new(config_path)?,
            server: Mutex::new(None),
        })
    }

    pub fn config(&self) -> AppConfig {
        self.config.get()
    }

    pub async fn start_server(
        &self,
        app: &AppHandle,
        host: String,
        port: u16,
    ) -> Result<(), String> {
        validate_host(&host)?;
        validate_port(port)?;
        let mut guard = self.server.lock().await;
        if let Some(current) = guard.as_ref() {
            if current.host == host && current.port == port {
                return Ok(());
            }
            let running = guard.take().expect("server entry exists");
            drop(guard);
            stop_running_server(running).await?;
            guard = self.server.lock().await;
        }

        let running = spawn_signaling_server(app, host, port).await?;
        *guard = Some(running);
        emit_members_changed(app);
        Ok(())
    }

    async fn stop_server(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self.server.lock().await;
        let Some(running) = guard.take() else {
            log::info!("signaling server stop requested but server is not running");
            return Ok(());
        };
        drop(guard);
        stop_running_server(running).await?;
        emit_members_changed(app);
        Ok(())
    }

    async fn status(&self) -> ServerStatus {
        let guard = self.server.lock().await;
        if let Some(server) = guard.as_ref() {
            ServerStatus {
                running: true,
                host: Some(server.host.clone()),
                port: Some(server.port),
            }
        } else {
            ServerStatus {
                running: false,
                host: None,
                port: None,
            }
        }
    }

    async fn members(&self) -> ServerMembersSnapshot {
        let relay_state = {
            let guard = self.server.lock().await;
            guard.as_ref().map(|server| server.relay_state.clone())
        };

        let Some(relay_state) = relay_state else {
            return ServerMembersSnapshot {
                running: false,
                connections: Vec::new(),
            };
        };

        let connections = relay_state.members_snapshot().await;
        ServerMembersSnapshot {
            running: true,
            connections,
        }
    }

    async fn set_config(
        &self,
        _app: &AppHandle,
        update: ConfigUpdate,
    ) -> Result<AppConfig, String> {
        let next = AppConfig {
            host: update.host,
            port: update.port,
        };
        validate_config(&next)?;
        self.config.set(next.clone())?;
        Ok(next)
    }
}

#[derive(Clone)]
struct RelayState {
    app: AppHandle,
    clients: Arc<AsyncRwLock<HashMap<u64, ConnectedClient>>>,
}

impl RelayState {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            clients: Arc::new(AsyncRwLock::new(HashMap::new())),
        }
    }

    async fn members_snapshot(&self) -> Vec<MemberConnection> {
        let clients = self.clients.read().await;
        let mut connections = clients
            .iter()
            .map(|(client_id, client)| MemberConnection {
                client_id: *client_id,
                user_id: client.user_id.clone(),
                rtc_peer_id: client.rtc_peer_id.clone(),
            })
            .collect::<Vec<_>>();
        connections.sort_by_key(|connection| connection.client_id);
        connections
    }

    fn emit_members_changed(&self) {
        emit_members_changed(&self.app);
    }
}

#[derive(Clone)]
struct ConnectedClient {
    user_id: Option<String>,
    rtc_peer_id: Option<String>,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMembersSnapshot {
    running: bool,
    connections: Vec<MemberConnection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberConnection {
    client_id: u64,
    user_id: Option<String>,
    rtc_peer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberState {
    user_id: String,
    rtc_peer_id: Option<String>,
}

#[tauri::command]
pub async fn server_start(
    host: Option<String>,
    port: Option<u16>,
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<ServerStatus, String> {
    let config = state.config.get();
    let selected_host = host.unwrap_or(config.host);
    let selected_port = port.unwrap_or(config.port);
    state
        .start_server(&app, selected_host.clone(), selected_port)
        .await?;
    Ok(ServerStatus {
        running: true,
        host: Some(selected_host),
        port: Some(selected_port),
    })
}

#[tauri::command]
pub async fn server_stop(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<ServerStatus, String> {
    state.stop_server(&app).await?;
    Ok(ServerStatus {
        running: false,
        host: None,
        port: None,
    })
}

#[tauri::command]
pub async fn server_status(state: State<'_, AppRuntimeState>) -> Result<ServerStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn server_members(
    state: State<'_, AppRuntimeState>,
) -> Result<ServerMembersSnapshot, String> {
    Ok(state.members().await)
}

#[tauri::command]
pub fn config_get(state: State<'_, AppRuntimeState>) -> Result<AppConfig, String> {
    Ok(state.config())
}

#[tauri::command]
pub async fn config_set(
    payload: ConfigUpdate,
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<AppConfig, String> {
    state.set_config(&app, payload).await
}

async fn spawn_signaling_server(
    app: &AppHandle,
    host: String,
    port: u16,
) -> Result<RunningServer, String> {
    let listener = TcpListener::bind((host.as_str(), port))
        .await
        .map_err(|err| format!("failed to bind {host}:{port}: {err}"))?;

    let relay_state = RelayState::new(app.clone());
    let router = Router::new()
        .route("/signaling", get(ws_handler))
        .with_state(relay_state.clone());

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let addr = listener
        .local_addr()
        .map_err(|err| format!("failed to read local addr: {err}"))?;

    let task = tauri::async_runtime::spawn(async move {
        let server =
            axum::serve(listener, router.into_make_service()).with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            });
        if let Err(err) = server.await {
            log::error!("signaling server stopped with error: {err}");
        }
    });

    log::info!("signaling server started on http://{}", addr);

    Ok(RunningServer {
        host,
        port,
        relay_state,
        shutdown_tx,
        task,
    })
}

async fn stop_running_server(running: RunningServer) -> Result<(), String> {
    let host = running.host.clone();
    let port = running.port;
    log::info!("signaling server stopping on {host}:{port}");

    let _ = running.shutdown_tx.send(());
    if let Err(err) = running.task.await {
        let message = format!("failed to stop signaling server task: {err}");
        log::error!("signaling server failed to stop on {host}:{port}: {err}");
        return Err(message);
    }

    log::info!("signaling server stopped on {host}:{port}");
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<RelayState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: RelayState) {
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::Relaxed);
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    {
        let mut clients = state.clients.write().await;
        clients.insert(
            client_id,
            ConnectedClient {
                user_id: None,
                rtc_peer_id: None,
                tx,
            },
        );
    }
    state.emit_members_changed();

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(payload) = rx.recv().await {
            if sender.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = receiver.next().await {
        match message {
            Message::Text(text) => {
                let text = text.to_string();
                if let Err(err) = handle_signal_message(&state, client_id, &text).await {
                    send_error_to_client(&state, client_id, 400, &err).await;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    let removed = {
        let mut clients = state.clients.write().await;
        clients.remove(&client_id)
    };
    if let Some(client) = removed {
        if let Some(user_id) = client.user_id {
            let should_broadcast = {
                let clients = state.clients.read().await;
                !has_registered_user(&clients, &user_id)
            };
            if should_broadcast {
                broadcast_json_to_registered_clients(
                    &state,
                    client_id,
                    json!({
                        "type": "memberLeft",
                        "userId": user_id,
                    }),
                )
                .await;
            }
        }
        state.emit_members_changed();
    }
    let _ = writer.await;
}

async fn handle_signal_message(
    state: &RelayState,
    sender_id: u64,
    raw: &str,
) -> Result<(), String> {
    let payload: Value =
        serde_json::from_str(raw).map_err(|err| format!("invalid json message: {err}"))?;
    let message_type = payload
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "message type is required".to_string())?;

    match message_type {
        "connectSignalingServer" => handle_connect_signaling_server(state, sender_id).await,
        "updateRtcPresence" => handle_update_rtc_presence(state, sender_id, &payload).await,
        "sendUser" => {
            let to_user_id = required_string(&payload, "toUserId")?;
            let payload = payload.get("payload").cloned().unwrap_or(Value::Null);
            handle_send_user(state, sender_id, to_user_id, payload).await
        }
        "sendRtcOffer" => {
            let to_user_id = required_string(&payload, "toUserId")?;
            let payload = payload.get("payload").cloned().unwrap_or(Value::Null);
            handle_send_rtc(state, sender_id, to_user_id, "rtcOffer", payload).await
        }
        "sendRtcAnswer" => {
            let to_user_id = required_string(&payload, "toUserId")?;
            let payload = payload.get("payload").cloned().unwrap_or(Value::Null);
            handle_send_rtc(state, sender_id, to_user_id, "rtcAnswer", payload).await
        }
        "sendRtcIce" => {
            let to_user_id = required_string(&payload, "toUserId")?;
            let payload = payload.get("payload").cloned().unwrap_or(Value::Null);
            handle_send_rtc(state, sender_id, to_user_id, "rtcIce", payload).await
        }
        _ => Err(format!("unsupported message type: {message_type}")),
    }
}

async fn handle_connect_signaling_server(state: &RelayState, client_id: u64) -> Result<(), String> {
    let user_id = format!("member-{client_id}");
    let (members, member_states, newly_registered) = {
        let mut clients = state.clients.write().await;
        let members = registered_user_ids(&clients, client_id);
        let member_states = registered_member_states(&clients, client_id);
        let client = clients
            .get_mut(&client_id)
            .ok_or_else(|| "client not connected".to_string())?;
        if let Some(current_user_id) = client.user_id.as_ref() {
            if current_user_id != &user_id {
                return Err("userId is already registered for this connection".to_string());
            }
            (members, member_states, false)
        } else {
            client.user_id = Some(user_id.clone());
            (members, member_states, true)
        }
    };

    send_json_to_client(
        state,
        client_id,
        json!({
            "type": "connectSignalingServerOk",
            "userId": user_id,
            "members": members,
            "memberStates": member_states,
        }),
    )
    .await;
    if newly_registered && !members.iter().any(|member| member == &user_id) {
        broadcast_json_to_registered_clients(
            state,
            client_id,
            json!({
                "type": "memberJoined",
                "userId": user_id,
            }),
        )
        .await;
        state.emit_members_changed();
    }
    Ok(())
}

async fn handle_update_rtc_presence(
    state: &RelayState,
    sender_id: u64,
    payload: &Value,
) -> Result<(), String> {
    let peer_user_id = payload
        .get("peerUserId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let user_id = {
        let mut clients = state.clients.write().await;
        let client = clients
            .get_mut(&sender_id)
            .ok_or_else(|| "client not connected".to_string())?;
        let user_id = client
            .user_id
            .clone()
            .ok_or_else(|| "connectSignalingServer is required before this message".to_string())?;
        if client.rtc_peer_id == peer_user_id {
            return Ok(());
        }
        client.rtc_peer_id = peer_user_id.clone();
        user_id
    };

    broadcast_json_to_registered_clients(
        state,
        sender_id,
        json!({
            "type": "memberPresenceChanged",
            "userId": user_id,
            "rtcPeerId": peer_user_id,
        }),
    )
    .await;
    Ok(())
}

async fn handle_send_user(
    state: &RelayState,
    sender_id: u64,
    to_user_id: String,
    payload: Value,
) -> Result<(), String> {
    let from_user_id = {
        let clients = state.clients.read().await;
        current_user_id(&clients, sender_id)?
    };
    let message = json!({
        "type": "message",
        "fromUserId": from_user_id,
        "toUserId": to_user_id,
        "payload": payload,
    });

    let delivered = send_json_to_user(state, sender_id, &to_user_id, message).await;
    if delivered == 0 {
        return Err(format!("target user not found: {to_user_id}"));
    }
    Ok(())
}

async fn handle_send_rtc(
    state: &RelayState,
    sender_id: u64,
    to_user_id: String,
    outgoing_type: &str,
    payload: Value,
) -> Result<(), String> {
    let from_user_id = {
        let clients = state.clients.read().await;
        current_user_id(&clients, sender_id)?
    };
    let message = json!({
        "type": outgoing_type,
        "fromUserId": from_user_id,
        "payload": payload,
    });

    let delivered = send_json_to_user(state, sender_id, &to_user_id, message).await;
    if delivered == 0 {
        return Err(format!("target user not found: {to_user_id}"));
    }
    Ok(())
}

async fn send_json_to_client(state: &RelayState, client_id: u64, payload: Value) {
    let text = payload.to_string();
    let clients = state.clients.read().await;
    if let Some(client) = clients.get(&client_id) {
        let _ = client.tx.send(text);
    }
}

async fn send_error_to_client(state: &RelayState, client_id: u64, code: u16, message: &str) {
    send_json_to_client(
        state,
        client_id,
        json!({
            "type": "error",
            "code": code,
            "message": message,
        }),
    )
    .await;
}

async fn broadcast_json_to_registered_clients(state: &RelayState, sender_id: u64, payload: Value) {
    let text = payload.to_string();
    let clients = state.clients.read().await;
    for (client_id, client) in clients.iter() {
        if *client_id == sender_id || client.user_id.is_none() {
            continue;
        }
        let _ = client.tx.send(text.clone());
    }
}

async fn send_json_to_user(
    state: &RelayState,
    sender_id: u64,
    user_id: &str,
    payload: Value,
) -> usize {
    let text = payload.to_string();
    let clients = state.clients.read().await;
    let mut delivered = 0;
    for (client_id, client) in clients.iter() {
        if *client_id == sender_id || client.user_id.as_deref() != Some(user_id) {
            continue;
        }
        if client.tx.send(text.clone()).is_ok() {
            delivered += 1;
        }
    }
    delivered
}

fn registered_user_ids(
    clients: &HashMap<u64, ConnectedClient>,
    current_client_id: u64,
) -> Vec<String> {
    let mut user_ids = BTreeSet::<String>::new();
    for (client_id, client) in clients.iter() {
        if *client_id == current_client_id {
            continue;
        }
        if let Some(user_id) = client.user_id.as_ref() {
            user_ids.insert(user_id.clone());
        }
    }
    user_ids.into_iter().collect()
}

fn registered_member_states(
    clients: &HashMap<u64, ConnectedClient>,
    current_client_id: u64,
) -> Vec<MemberState> {
    let mut states = clients
        .iter()
        .filter_map(|(client_id, client)| {
            if *client_id == current_client_id {
                return None;
            }
            client.user_id.as_ref().map(|user_id| MemberState {
                user_id: user_id.clone(),
                rtc_peer_id: client.rtc_peer_id.clone(),
            })
        })
        .collect::<Vec<_>>();
    states.sort_by(|a, b| a.user_id.cmp(&b.user_id));
    states
}

fn has_registered_user(clients: &HashMap<u64, ConnectedClient>, user_id: &str) -> bool {
    clients
        .values()
        .any(|client| client.user_id.as_deref() == Some(user_id))
}

fn current_user_id(
    clients: &HashMap<u64, ConnectedClient>,
    client_id: u64,
) -> Result<String, String> {
    clients
        .get(&client_id)
        .ok_or_else(|| "client not connected".to_string())?
        .user_id
        .clone()
        .ok_or_else(|| "connectSignalingServer is required before this message".to_string())
}

fn required_string(payload: &Value, field: &str) -> Result<String, String> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| format!("{field} is required"))?;
    if value.is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(value.to_string())
}

fn validate_host(host: &str) -> Result<(), String> {
    match host {
        "127.0.0.1" | "0.0.0.0" => Ok(()),
        _ => Err("host must be 127.0.0.1 or 0.0.0.0".to_string()),
    }
}

fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("port must be between 1 and 65535".to_string());
    }
    Ok(())
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    validate_host(&config.host)?;
    validate_port(config.port)
}

fn emit_members_changed(app: &AppHandle) {
    if let Err(err) = app.emit(MEMBERS_CHANGED_EVENT, ()) {
        log::warn!("failed to emit signaling members change event: {err}");
    }
}
