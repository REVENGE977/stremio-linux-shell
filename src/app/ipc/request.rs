use serde::Deserialize;
use serde_json::Value;

use crate::app::ipc::event::IpcEventDiscord;

use super::event::{IpcEvent, IpcEventMpv};

#[derive(Deserialize, Debug)]
pub struct IpcMessageRequest {
    r#type: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
pub struct IpcMessageRequestWinSetVisilibty {
    fullscreen: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IpcMessageRequestMediaMetadata {
    title: String,
    artist: Option<String>,
    art_url: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct IpcMessageRequestMediaStatus {
    paused: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IpcMessageRequestDiscordSetActivity {
    details: String,
    state: String,
    image: Option<String>,
}

impl TryFrom<IpcMessageRequest> for IpcEvent {
    type Error = String;

    fn try_from(value: IpcMessageRequest) -> Result<Self, Self::Error> {
        match value.r#type {
            3 => Ok(IpcEvent::Init),
            6 => match value.args {
                Some(args) => {
                    let args: Vec<Value> =
                        serde_json::from_value(args).map_err(|_| "Invalid arguments")?;
                    let name = args.first().and_then(Value::as_str).ok_or("Invalid name")?;
                    let data = args.get(1).cloned();

                    match data {
                        Some(data) => match name {
                            "win-set-visibility" => {
                                let data: IpcMessageRequestWinSetVisilibty =
                                    serde_json::from_value(data)
                                        .map_err(|_| "Invalid win-set-visibility object")?;

                                Ok(IpcEvent::Fullscreen(data.fullscreen))
                            }
                            "mpv-command" => {
                                let data: Vec<Value> = serde_json::from_value(data)
                                    .map_err(|_| "Invalid mpv-command arguments")?;
                                if data.is_empty() {
                                    return Err("Empty mpv-command arguments".into());
                                }
                                let name = data[0]
                                    .as_str()
                                    .ok_or("Invalid mpv-command name")?
                                    .to_string();

                                let mut args = vec![];
                                for arg in data.iter().skip(1) {
                                    if let Some(s) = arg.as_str() {
                                        args.push(s.to_string());
                                    } else if let Some(n) = arg.as_f64() {
                                        args.push(n.to_string());
                                    } else if let Some(b) = arg.as_bool() {
                                        args.push(b.to_string());
                                    } else {
                                        args.push(arg.to_string());
                                    }
                                }

                                Ok(IpcEvent::Mpv(IpcEventMpv::Command((name, args))))
                            }
                            "mpv-observe-prop" => {
                                let name = data.as_str().ok_or("Invalid mpv-observe-prop name")?;
                                Ok(IpcEvent::Mpv(IpcEventMpv::Observe(name.to_owned())))
                            }
                            "mpv-set-prop" => {
                                let key_value: Vec<Value> = serde_json::from_value(data)
                                    .map_err(|_| "Invalid mpv-set-prop arguments")?;

                                let name = key_value[0]
                                    .as_str()
                                    .ok_or("Invalid mpv-set-prop name")?
                                    .to_owned();

                                let value = key_value
                                    .get(1)
                                    .ok_or("Invalid mpv-set-prop value")?
                                    .to_owned();

                                Ok(IpcEvent::Mpv(IpcEventMpv::Set((name, value))))
                            }
                            "media.metadata" => {
                                let data: IpcMessageRequestMediaMetadata =
                                    serde_json::from_value(data)
                                        .map_err(|_| "Invalid media.metadata object")?;

                                Ok(IpcEvent::MediaMetadata((
                                    data.title,
                                    data.artist,
                                    data.art_url,
                                )))
                            }
                            "media.status" => {
                                let data: IpcMessageRequestMediaStatus =
                                    serde_json::from_value(data)
                                        .map_err(|_| "Invalid media.status object")?;

                                Ok(IpcEvent::MediaStatus(data.paused))
                            }
                            "discord-connect" => Ok(IpcEvent::Discord(IpcEventDiscord::Connect)),
                            "discord-disconnect" => {
                                Ok(IpcEvent::Discord(IpcEventDiscord::Disconnect))
                            }
                            "discord-set-activity" => {
                                let data: IpcMessageRequestDiscordSetActivity =
                                    serde_json::from_value(data)
                                        .map_err(|_| "Invalid discord-set-activity object")?;

                                Ok(IpcEvent::Discord(IpcEventDiscord::SetActivity((
                                    data.details,
                                    data.state,
                                    data.image,
                                ))))
                            }
                            "discord-clear-activity" => {
                                Ok(IpcEvent::Discord(IpcEventDiscord::ClearActivity))
                            }
                            "mpv-set-gpu-video-processing" => Ok(IpcEvent::Ignored),
                            method => Err(format!("Invalid method: {method}")),
                        },
                        None => match name {
                            "app-ready" => Ok(IpcEvent::Ready),
                            "quit" => Ok(IpcEvent::Quit),
                            method => Err(format!("Invalid method: {method}")),
                        },
                    }
                }
                None => Err("Invalid arguments".into()),
            },
            r#type => Err(format!("Invalid type: {}", r#type)),
        }
    }
}
