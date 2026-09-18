# LexiNote

LexiNote is a lightweight, local-first English vocabulary notebook for Windows. It stays in the system tray, opens with `Ctrl+Shift+Space`, and keeps your vocabulary sets on your device.

## Features

- Organize vocabulary into multiple sets.
- Look up English definitions, IPA, pronunciation audio, and translations.
- Keep working offline; words are saved locally when lookup services are unavailable.
- Search saved words instantly.
- Light and dark themes.
- Optional start with Windows.
- System-tray workflow and global keyboard shortcut.

## Download

Download the latest Windows installer from [GitHub Releases](https://github.com/hoangvu1806/NoteVocab/releases/latest):

- `LexiNote_<version>_x64-setup.exe` — recommended installer.
- `LexiNote_<version>_x64_en-US.msi` — MSI package for managed installation.

Windows may show a SmartScreen warning because community builds are not code-signed. Verify the SHA-256 checksums published with each release before installing.

## Data and privacy

Vocabulary data is stored locally in the application's data directory. When adding a word online, LexiNote sends the word to [Datamuse](https://www.datamuse.com/api/) and [MyMemory](https://mymemory.translated.net/) to retrieve dictionary and translation data. No account is required.

## Development

Requirements:

- Node.js 20 or newer
- Rust stable toolchain
- Windows prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

```powershell
git clone https://github.com/hoangvu1806/NoteVocab.git
cd NoteVocab
npm ci
npm run tauri dev
```

Useful commands:

```powershell
npm run build
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Closing the window hides LexiNote. Use the tray menu to quit it completely.

## Releasing

1. Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Add release notes to `CHANGELOG.md`.
3. Commit the changes and create a matching tag, for example `v1.0.0`.
4. Push the commit and tag. The release workflow builds the Windows installers, generates SHA-256 checksums, and attaches them to a GitHub Release.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening a pull request or reporting a vulnerability.

## License

LexiNote is available under the [MIT License](LICENSE).
