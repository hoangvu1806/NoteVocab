use serde::Serialize;
use serde_json::Value;
use std::{fs, path::PathBuf, sync::OnceLock, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW_MARGIN: i32 = 18;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LookupResult {
    word: String,
    phonetic: String,
    audio: String,
    part_of_speech: String,
    definition: String,
    example: String,
    translation: String,
}

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }

    let client = reqwest::Client::builder()
        .user_agent("LexiNote/1.0.0")
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("could not create HTTP client: {error}"))?;

    // Another command can win this race; in that case, use the client it stored.
    let _ = HTTP_CLIENT.set(client);
    HTTP_CLIENT
        .get()
        .ok_or_else(|| "could not initialize HTTP client".to_string())
}

async fn fetch_json(request: reqwest::RequestBuilder, service: &str) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("{service}: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{service}: HTTP {status}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("{service}: invalid response: {error}"))
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("vocabulary.json"))
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, payload: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&payload)
        .map_err(|error| format!("Invalid vocabulary data: {error}"))?;
    fs::write(state_path(&app)?, payload).map_err(|error| error.to_string())
}

fn position_bottom_right(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window
        .current_monitor()?
        .or(window.primary_monitor()?)
        .ok_or_else(|| tauri::Error::AssetNotFound("No monitor is available".to_string()))?;
    let area = monitor.work_area();
    let window_size = window.outer_size()?;
    let x = area.position.x + area.size.width as i32 - window_size.width as i32 - WINDOW_MARGIN;
    let y = area.position.y + area.size.height as i32 - window_size.height as i32 - WINDOW_MARGIN;
    window.set_position(PhysicalPosition::new(x, y))
}

fn show_and_focus(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = position_bottom_right(window);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("quick-focus", ());
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_and_focus(&window);
        }
    }
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn position_window(window: WebviewWindow) -> Result<(), String> {
    position_bottom_right(&window).map_err(|error| error.to_string())
}

#[tauri::command]
async fn lookup_word(word: String, language: String) -> Result<LookupResult, String> {
    let word = word.trim();
    if word.is_empty() || word.len() > 80 {
        return Err("Enter a valid word".to_string());
    }
    const SUPPORTED_LANGUAGES: &[&str] = &["vi", "zh-CN", "ja", "ko", "th", "id", "es", "fr", "de"];
    let language = if SUPPORTED_LANGUAGES.contains(&language.as_str()) {
        language
    } else {
        "vi".to_string()
    };

    let client = http_client()?;

    // Datamuse is the primary dictionary source. It returns the exact query,
    // definition, part of speech and IPA together without waiting on a fallback.
    let dictionary_request = client
        .get("https://api.datamuse.com/words")
        .query(&[
            ("sp", word),
            ("qe", "sp"),
            ("md", "dpr"),
            ("ipa", "1"),
            ("max", "1"),
        ])
        .timeout(Duration::from_secs(4));
    let dictionary_request = fetch_json(dictionary_request, "Dictionary API");
    let language_pair = format!("en|{language}");
    let translation_request = client
        .get("https://api.mymemory.translated.net/get")
        .query(&[("q", word), ("langpair", language_pair.as_str())])
        .timeout(Duration::from_secs(4));
    let translation_request = fetch_json(translation_request, "Translation API");

    let (dictionary_response, translation_response) =
        futures::join!(dictionary_request, translation_request);
    let mut result = LookupResult {
        word: word.to_string(),
        ..Default::default()
    };
    let mut any_success = false;

    if let Ok(value) = &dictionary_response {
        any_success |= apply_datamuse(&mut result, value);
    }

    if let Ok(value) = &translation_response {
        result.translation =
            string_at(value, &["responseData", "translatedText"]).unwrap_or_default();
        any_success |= !result.translation.is_empty();
    }

    if any_success {
        Ok(result)
    } else {
        let dictionary_error = dictionary_response
            .err()
            .unwrap_or_else(|| "Dictionary API returned no entry".to_string());
        let translation_error = translation_response
            .err()
            .unwrap_or_else(|| "Translation API returned no translation".to_string());
        Err(format!("{dictionary_error}; {translation_error}"))
    }
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn apply_datamuse(result: &mut LookupResult, value: &Value) -> bool {
    let Some(entry) = value.as_array().and_then(|items| items.first()) else {
        return false;
    };

    let tags = entry
        .get("tags")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();

    if result.phonetic.is_empty() {
        result.phonetic = tags
            .iter()
            .filter_map(Value::as_str)
            .find_map(|tag| tag.strip_prefix("ipa_pron:"))
            .unwrap_or_default()
            .to_string();
    }

    if result.part_of_speech.is_empty() {
        result.part_of_speech = tags
            .iter()
            .filter_map(Value::as_str)
            .find_map(|tag| match tag {
                "n" => Some("noun"),
                "v" => Some("verb"),
                "adj" => Some("adjective"),
                "adv" => Some("adverb"),
                _ => None,
            })
            .unwrap_or_default()
            .to_string();
    }

    if result.definition.is_empty() {
        if let Some(definition) = entry
            .get("defs")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_str)
        {
            let (part, text) = definition.split_once('\t').unwrap_or(("", definition));
            result.definition = text.trim().to_string();
            if result.part_of_speech.is_empty() {
                result.part_of_speech = match part {
                    "n" => "noun",
                    "v" => "verb",
                    "adj" => "adjective",
                    "adv" => "adverb",
                    _ => "",
                }
                .to_string();
            }
        }
    }

    !result.phonetic.is_empty()
        || !result.part_of_speech.is_empty()
        || !result.definition.is_empty()
}

#[cfg(test)]
mod tests {
    use super::{apply_datamuse, LookupResult};
    use serde_json::json;

    #[test]
    fn datamuse_fills_dictionary_details() {
        let value = json!([{
            "word": "durable",
            "tags": ["query", "adj", "n", "ipa_pron:dˈʊrʌbʌɫ"],
            "defs": ["adj\tAble to resist wear or decay; lasting; enduring."]
        }]);
        let mut result = LookupResult::default();

        assert!(apply_datamuse(&mut result, &value));
        assert_eq!(result.phonetic, "dˈʊrʌbʌɫ");
        assert_eq!(result.part_of_speech, "adjective");
        assert_eq!(
            result.definition,
            "Able to resist wear or decay; lasting; enduring."
        );
    }

    #[test]
    fn datamuse_does_not_replace_existing_details() {
        let value = json!([{
            "tags": ["n", "ipa_pron:fɔːl"],
            "defs": ["n\tA fallback definition."]
        }]);
        let mut result = LookupResult {
            phonetic: "primary".to_string(),
            part_of_speech: "verb".to_string(),
            definition: "Primary definition.".to_string(),
            ..Default::default()
        };

        assert!(apply_datamuse(&mut result, &value));
        assert_eq!(result.phonetic, "primary");
        assert_eq!(result.part_of_speech, "verb");
        assert_eq!(result.definition, "Primary definition.");
    }
}

pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            hide_window,
            position_window,
            lookup_word
        ])
        .setup(move |app| {
            // Another running application may already own this shortcut. LexiNote
            // must remain usable through the tray even in that case.
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("Global shortcut unavailable: {error}");
            }

            let show_item = MenuItem::with_id(app, "show", "Show LexiNote", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("app icon is configured")
                        .clone(),
                )
                .tooltip("LexiNote · Ctrl+Shift+Space")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_and_focus(&window);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = position_bottom_right(&window);
                if std::env::args().any(|argument| argument == "--hidden") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LexiNote");
}
