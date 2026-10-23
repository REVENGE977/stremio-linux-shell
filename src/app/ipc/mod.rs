pub mod event;
mod request;
mod response;

use event::IpcEvent;
use response::IpcMessageResponse;
use tracing::warn;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const TRANSPORT_NAME: &str = "transport";

pub fn parse_request(data: &str) -> Result<IpcEvent, ()> {
    IpcEvent::try_from(data).map_err(|e| {
        if !data.contains("\"action\"") {
            warn!("{e}");
        }
    })
}

pub fn create_response(event: IpcEvent) -> String {
    let message = IpcMessageResponse::try_from(event).ok();
    serde_json::to_string(&message).expect("Failed to convert IpcMessage to string")
}

#[cfg(test)]
mod tests {
    use super::event::{IpcEvent, IpcEventMpv};
    use super::*;

    #[test]
    fn test_parse_mpv_set_gpu_video_processing() {
        let json = r#"{"type": 6, "args": ["mpv-set-gpu-video-processing", true]}"#;
        let result = parse_request(json);
        assert_eq!(result, Ok(IpcEvent::Ignored));
    }

    #[test]
    fn test_parse_mpv_command_strings() {
        let json = r#"{"type": 6, "args": ["mpv-command", ["seek", "92.5", "absolute"]]}"#;
        let result = parse_request(json);
        assert_eq!(
            result,
            Ok(IpcEvent::Mpv(IpcEventMpv::Command((
                "seek".to_string(),
                vec!["92.5".to_string(), "absolute".to_string()]
            ))))
        );
    }

    #[test]
    fn test_parse_mpv_command_numbers() {
        let json = r#"{"type": 6, "args": ["mpv-command", ["seek", 92.5, "absolute"]]}"#;
        let result = parse_request(json);
        assert_eq!(
            result,
            Ok(IpcEvent::Mpv(IpcEventMpv::Command((
                "seek".to_string(),
                vec!["92.5".to_string(), "absolute".to_string()]
            ))))
        );
    }
}
