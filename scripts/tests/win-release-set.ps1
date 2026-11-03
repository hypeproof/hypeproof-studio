# Release API answers for the Windows fallback controls in install-win-fixture.ps1
# and bootstrap-win-private-fixture.ps1. Releases can be macOS only
# (config/release-platforms.json), so "latest" for Windows means the newest
# published release that has a Windows installer.
#
# Get-FixtureReleaseApi returns the JSON gh api would print for $Url, or $null for
# a 404. It throws on any endpoint the scenario must not ask for, so "latest has
# Windows, so the list is never read" is measured, not assumed.
function global:Get-FixtureReleaseApi([string]$Url, [string]$Scenario, [string]$Name, [string]$Digest) {
    $base = 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases'
    $win = @{ name = $Name; digest = "sha256:$Digest" }
    $mac = @{ name = 'HypeProof-Studio-darwin-arm64.zip'; digest = "sha256:$('a' * 64)" }
    function rel($tag, $created, $assets, [bool]$draft = $false, [bool]$pre = $false) {
        return @{ tag_name = $tag; created_at = $created; draft = $draft; prerelease = $pre; assets = @($assets) }
    }
    $winLatest  = rel 'v0.1.56' '2026-10-12T00:00:00Z' @($mac, $win)
    $macOnly    = rel 'v0.1.57' '2026-10-19T00:00:00Z' @($mac)
    $preDecoy   = rel 'v0.1.58-rc.1' '2026-10-20T00:00:00Z' @($mac, $win) $false $true
    $draftDecoy = rel 'v0.1.59' '2026-10-21T00:00:00Z' @($mac, $win) $true $false
    $winNewest  = rel 'v0.1.55' '2026-10-10T00:00:00Z' @($mac, $win)
    $winOld     = rel 'v0.1.50' '2026-09-01T00:00:00Z' @($mac, $win)
    $answer = $null
    switch ($Scenario) {
        { $_ -in @('success', 'bad-digest', 'bad-name', 'missing-digest') } {
            if ($Url -eq "$base/latest") { $answer = $winLatest }
            elseif ($Url -eq "$base/tags/vlatest") { return $null }
            else { throw "latest has a Windows installer; unexpected call $Url" }
        }
        'mac-only-latest' {
            if ($Url -eq "$base/latest") { $answer = $macOnly }
            # Out of created_at order on purpose, with a newer prerelease and draft
            # that carry Windows installers: neither may be picked.
            elseif ($Url -eq "$base`?per_page=100&page=1") { $answer = @($winOld, $draftDecoy, $preDecoy, $macOnly, $winNewest) }
            else { throw "unexpected call $Url" }
        }
        'paged' {
            # A full first page without Windows: the second page must be read.
            if ($Url -eq "$base/latest") { $answer = $macOnly }
            elseif ($Url -eq "$base`?per_page=100&page=1") {
                $answer = @(1..100 | ForEach-Object { rel ('v0.2.{0}' -f $_) ('2026-11-{0:D2}T00:00:00Z' -f [Math]::Min($_, 28)) @($mac) })
            }
            elseif ($Url -eq "$base`?per_page=100&page=2") { $answer = @($winNewest) }
            else { throw "unexpected call $Url" }
        }
        'no-windows' {
            if ($Url -eq "$base/latest") { $answer = $macOnly }
            elseif ($Url -eq "$base`?per_page=100&page=1") { $answer = @($draftDecoy, $preDecoy, $macOnly) }
            else { throw "unexpected call $Url" }
        }
        'pinned' {
            if ($Url -eq "$base/tags/v0.1.50") { $answer = $winOld }
            else { throw "a pinned version asks only for its tag; unexpected call $Url" }
        }
        'pinned-missing' {
            # A pinned version that does not exist falls back to the newest
            # release with Windows, as install.ps1 always fell back to latest.
            if ($Url -eq "$base/tags/v0.1.40") { return $null }
            elseif ($Url -eq "$base/latest") { $answer = $winLatest }
            else { throw "unexpected call $Url" }
        }
        'pinned-mac-only' {
            if ($Url -eq "$base/tags/v0.1.57") { $answer = $macOnly }
            else { throw "a pinned version asks only for its tag; unexpected call $Url" }
        }
        default { throw "unknown scenario $Scenario" }
    }
    # -InputObject keeps a one-element list a JSON array.
    return (ConvertTo-Json -InputObject $answer -Depth 6)
}
