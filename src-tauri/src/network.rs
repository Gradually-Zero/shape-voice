use serde::Serialize;
use std::{
    collections::BTreeSet,
    net::{IpAddr, UdpSocket},
    process::Command,
};

const ROUTE_PROBE_ADDR: &str = "192.0.2.1:80";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIpInfo {
    ips: Vec<String>,
}

#[tauri::command]
pub fn network_get_local_ips() -> Result<LocalIpInfo, String> {
    let mut default_outbound_ip: Option<String> = None;

    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.connect(ROUTE_PROBE_ADDR);
        if let Ok(addr) = sock.local_addr() {
            match addr.ip() {
                IpAddr::V4(v4) if !v4.is_loopback() => default_outbound_ip = Some(v4.to_string()),
                IpAddr::V6(v6) if !v6.is_loopback() => default_outbound_ip = Some(v6.to_string()),
                _ => {}
            }
        }
    }

    let mut all_ips = collect_system_ips();
    let mut ordered = Vec::<String>::new();
    if let Some(default_ip) = default_outbound_ip {
        ordered.push(default_ip.clone());
        all_ips.remove(&default_ip);
    }
    ordered.extend(all_ips);

    Ok(LocalIpInfo { ips: ordered })
}

fn collect_system_ips() -> BTreeSet<String> {
    #[cfg(target_os = "windows")]
    {
        collect_ips_windows()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let from_ip = run_and_parse("ip", &["-o", "addr", "show"], |line| {
            extract_ip_tokens(line, &["inet", "inet6"])
        });
        if !from_ip.is_empty() {
            return from_ip;
        }
        run_and_parse("ifconfig", &[], |line| {
            extract_ip_tokens(line, &["inet", "inet6", "inet addr"])
        })
    }
}

#[cfg(target_os = "windows")]
fn collect_ips_windows() -> BTreeSet<String> {
    run_and_parse("ipconfig", &[], |line| {
        if !line.contains("IPv4") && !line.contains("IPv6") {
            return Vec::new();
        }
        let Some((_, right)) = line.split_once(':') else {
            return Vec::new();
        };
        extract_ip_from_segment(right)
            .into_iter()
            .map(|ip| ip.to_string())
            .collect()
    })
}

fn run_and_parse<F>(cmd: &str, args: &[&str], line_parser: F) -> BTreeSet<String>
where
    F: Fn(&str) -> Vec<String>,
{
    let mut set = BTreeSet::<String>::new();
    let output = Command::new(cmd).args(args).output();
    let Ok(output) = output else {
        return set;
    };
    if !output.status.success() {
        return set;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        for ip in line_parser(line) {
            if is_non_loopback_ip(&ip) {
                set.insert(ip);
            }
        }
    }
    set
}

#[cfg(not(target_os = "windows"))]
fn extract_ip_tokens(line: &str, prefixes: &[&str]) -> Vec<String> {
    let mut found = Vec::<String>::new();
    for prefix in prefixes {
        if let Some(rest) = line.split(prefix).nth(1) {
            for token in rest.split_whitespace() {
                if let Some(ip) = extract_ip_from_segment(token) {
                    found.push(ip.to_string());
                }
            }
        }
    }
    found
}

fn extract_ip_from_segment(segment: &str) -> Option<IpAddr> {
    let cleaned = segment
        .trim()
        .trim_matches(|c: char| c == ':' || c == '(' || c == ')' || c == ',');
    let no_prefix = cleaned.strip_prefix("addr:").unwrap_or(cleaned);
    let no_scope = no_prefix.split('%').next().unwrap_or(no_prefix);
    let no_mask = no_scope.split('/').next().unwrap_or(no_scope);
    no_mask.parse::<IpAddr>().ok()
}

fn is_non_loopback_ip(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<IpAddr>() else {
        return false;
    };
    match addr {
        IpAddr::V4(v4) => !v4.is_loopback(),
        IpAddr::V6(v6) => !v6.is_loopback(),
    }
}
