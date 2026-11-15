## DEC-SHELL-R-006: bundled Korean shell (2026-10-22; agent implementation choice)

Ship a Korean NLS bundle with the app and select it on every OS, including when
an existing user profile requests English. Do not modify the user's language-pack
cache or require a first-launch network request. Use the existing Korean quit and
update copy. The native app menu title is `하이프루프 스튜디오`; model names, versions
and user-authored names remain intact. Generate messages in packaging before
signing; refuse missing native menu/dialog/update keys and placeholder drift.
This is presentation only, default on, and introduces no grants or recipients.

The Korean shell uses a new native menu cache key so an upgraded English profile
cannot restore old English labels before its first renderer update. Native
Studio settings use a fixed Korean label map; their setting keys, values and
approval defaults remain unchanged. Local canonical builds generate the same
bundle as CI packaging.

