# Bundled Korean shell

Microsoft Korean language pack 1.118.1, MIT, obtained from:
https://open-vsx.org/api/MS-CEINTL/vscode-language-pack-ko/1.118.1/file/MS-CEINTL.vscode-language-pack-ko-1.118.1.vsix

VSIX SHA-256: `5e8697f2af6107d8909e06c7752d83b30f9edc0696c9cad3554bf67ad1faf804`.
`main.i18n.json` is verbatim; `overrides.json` supplies missing Studio/upstream keys.
The four upstream fixtures are verbatim VS Code commit
`560a9dba96f961efea7b1612916f89e5d5d4d679` (MIT, LICENSE.txt).
Regenerate the startup patch with `python3 scripts/patches/core/korean/build_patch.py`.
`shell-fixture.json` contains only native menu/dialog/update metadata from the
installed HypeProof Studio 2026.1020.2 shell (product commit
`e49f86952eaee885a42b77f8796073505b9eccac`), used to validate real key order and placeholders.
The installer always uses the target package's metadata, never this fixture.

Layer: App packaging, no Service contract change. Remove the patch, packaging
calls and these inputs together to return to upstream language-pack selection.
Only missing or incompatible non-native keys may retain the upstream default;
critical menu/dialog/update keys fail closed. New versions must review overrides.
