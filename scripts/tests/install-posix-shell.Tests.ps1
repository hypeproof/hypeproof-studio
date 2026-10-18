# Pester 5 tests for install.ps1 POSIX-shell detection (PRA-09, trial diagnosis I11).
#
# The installer asks winget for Git.Git in USER scope first, which lands Git Bash
# under %LOCALAPPDATA%\Programs\Git. The old check looked only at
# C:\Program Files\Git\bin\bash.exe, so that participant was pushed into the
# "Install Ubuntu on WSL?" prompt (admin + reboot). The doctor then passed on the
# inbox wsl.exe stub alone, which is not a shell.
#
# Every path here is mocked; nothing is installed. Functions are loaded from
# install.ps1 itself (AST), so the tests measure the shipped code, not a copy.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester scripts/tests/install-posix-shell.Tests.ps1 -Output Detailed"

BeforeAll {
    $scriptPath = Join-Path $PSScriptRoot '..' 'install.ps1'
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path -LiteralPath $scriptPath).Path, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count) { throw "install.ps1 does not parse: $($errs[0].Message)" }
    # Top-level functions only; Main is defined but never called here.
    $defs = $ast.EndBlock.Statements |
        Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] }
    foreach ($d in $defs) { . ([scriptblock]::Create($d.Extent.Text)) }

    # Environment the tests overwrite; restored in AfterAll.
    $script:SavedEnv = @{}
    foreach ($n in @('ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA')) {
        $script:SavedEnv[$n] = [Environment]::GetEnvironmentVariable($n)
    }

    # Script-level switches the functions read.
    $NoModifyPath = $true
    $SkipStudio   = $true
    $NonInteractive = $true

    $script:Machine = 'C:\Program Files\Git\bin\bash.exe'
    $script:User    = 'C:\Users\kid\AppData\Local\Programs\Git\bin\bash.exe'

    # A fake wsl executable: a .ps1 that prints what the real one prints and
    # exits with its code. `& <path>.ps1` sets $LASTEXITCODE like a native exe.
    $script:FakeDir = Join-Path ([System.IO.Path]::GetTempPath()) ('hps-posix-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $script:FakeDir | Out-Null
    # Inbox stub, no distro: help text on stdout, non-zero exit.
    $script:WslStub = Join-Path $script:FakeDir 'wsl-stub.ps1'
    Set-Content -LiteralPath $script:WslStub -Value @'
'Windows Subsystem for Linux has no installed distributions.'
'Distributions can be installed by visiting the Microsoft Store:'
exit -1
'@
    # Real WSL with a distro: UTF-16 output read as bytes leaves NULs behind.
    $script:WslDistro = Join-Path $script:FakeDir 'wsl-distro.ps1'
    Set-Content -LiteralPath $script:WslDistro -Value @'
"U`0b`0u`0n`0t`0u`0"
exit 0
'@
}

AfterAll {
    foreach ($n in $script:SavedEnv.Keys) {
        [Environment]::SetEnvironmentVariable($n, $script:SavedEnv[$n])
    }
    if ($script:FakeDir -and (Test-Path -LiteralPath $script:FakeDir)) {
        Remove-Item -LiteralPath $script:FakeDir -Recurse -Force
    }
}

Describe 'Find-GitBash' {
    BeforeEach {
        $env:ProgramFiles = 'C:\Program Files'
        ${env:ProgramFiles(x86)} = 'C:\Program Files (x86)'
        $env:ProgramW6432 = $null
        $env:LOCALAPPDATA = 'C:\Users\kid\AppData\Local'
        $script:Existing = @()
        Mock Test-Path { @(@($LiteralPath) + @($Path) | Where-Object { $_ } | Where-Object { $script:Existing -contains $_ }).Count -gt 0 }
        Mock Resolve-ToolCommand { $null }
    }

    It 'finds machine-scope Git (positive)' {
        $script:Existing = @($script:Machine)
        Find-GitBash | Should -Be $script:Machine
    }

    It 'finds user-scope Git under LOCALAPPDATA (positive)' {
        $script:Existing = @($script:User)
        Find-GitBash | Should -Be $script:User
    }

    It 'finds Git Bash next to the git.exe on PATH (custom install dir)' {
        $script:Existing = @('D:\Tools\Git\bin\bash.exe')
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = 'D:\Tools\Git\cmd\git.exe' } } -ParameterFilter { $name -eq 'git' }
        Find-GitBash | Should -Be 'D:\Tools\Git\bin\bash.exe'
    }

    It 'does not count the System32 WSL bash.exe launcher as Git Bash (negative)' {
        $script:Existing = @('C:\Windows\System32\bash.exe')
        Find-GitBash | Should -BeNullOrEmpty
    }

    It 'returns nothing when no Git is installed (negative)' {
        Find-GitBash | Should -BeNullOrEmpty
    }
}

Describe 'Test-WslDistro' {
    It 'is false for the inbox wsl.exe stub with no distro (negative)' {
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = $script:WslStub } } -ParameterFilter { $name -eq 'wsl' }
        Test-WslDistro | Should -BeFalse
    }

    It 'is false when wsl is absent (negative)' {
        Mock Resolve-ToolCommand { $null }
        Test-WslDistro | Should -BeFalse
    }

    It 'is true when wsl lists a distro, UTF-16 NULs included (positive)' {
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = $script:WslDistro } } -ParameterFilter { $name -eq 'wsl' }
        Test-WslDistro | Should -BeTrue
        @(Get-WslDistroNames) | Should -Be @('Ubuntu')
    }
}

Describe 'Ensure-PosixShell' {
    BeforeEach {
        $env:ProgramFiles = 'C:\Program Files'
        $env:LOCALAPPDATA = 'C:\Users\kid\AppData\Local'
        $script:Existing = @()
        Mock Test-Path { @(@($LiteralPath) + @($Path) | Where-Object { $_ } | Where-Object { $script:Existing -contains $_ }).Count -gt 0 }
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = $script:WslStub } } -ParameterFilter { $name -eq 'wsl' }
        Mock Resolve-ToolCommand { $null } -ParameterFilter { $name -ne 'wsl' }
        Mock Add-ToUserPath { }
        Mock Confirm-Or { $false }
        Mock Write-Host { }
    }

    It 'accepts user-scope Git without offering the WSL install (acceptance)' {
        $script:Existing = @($script:User)
        Ensure-PosixShell @{ path_edits = @() } | Should -BeTrue
        Should -Invoke Confirm-Or -Times 0 -Exactly
        Should -Invoke Add-ToUserPath -Times 1 -Exactly -ParameterFilter { $dir -eq 'C:\Users\kid\AppData\Local\Programs\Git\bin' }
    }

    It 'accepts machine-scope Git without offering the WSL install' {
        $script:Existing = @($script:Machine)
        Ensure-PosixShell @{ path_edits = @() } | Should -BeTrue
        Should -Invoke Confirm-Or -Times 0 -Exactly
    }

    It 'does not report the wsl stub as a shell and fails when the WSL offer is declined (negative)' {
        Ensure-PosixShell @{ path_edits = @() } | Should -BeFalse
        Should -Invoke Confirm-Or -Times 1 -Exactly
    }
}

Describe 'Invoke-Doctor POSIX shell check' {
    BeforeEach {
        $env:ProgramFiles = 'C:\Program Files'
        $env:LOCALAPPDATA = 'C:\Users\kid\AppData\Local'
        $script:Existing = @()
        Mock Test-Path { @(@($LiteralPath) + @($Path) | Where-Object { $_ } | Where-Object { $script:Existing -contains $_ }).Count -gt 0 }
        Mock Update-ProcessPath { }
        Mock Get-SeededSdk { [pscustomobject]@{ version = '0.0.0' } }
        Mock Write-Host { }
        $script:Manifest = @{ tools = @(); studio = @{ version = '0.0.0' } }
    }

    It 'passes with user-scope Git (positive)' {
        $script:Existing = @($script:User)
        Mock Resolve-ToolCommand { $null }
        Invoke-Doctor $script:Manifest @{ studio = $null } | Should -Be 0
    }

    It 'passes with machine-scope Git (positive)' {
        $script:Existing = @($script:Machine)
        Mock Resolve-ToolCommand { $null }
        Invoke-Doctor $script:Manifest @{ studio = $null } | Should -Be 0
    }

    It 'fails on the inbox wsl.exe stub alone (negative)' {
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = $script:WslStub } } -ParameterFilter { $name -eq 'wsl' }
        Mock Resolve-ToolCommand { $null } -ParameterFilter { $name -ne 'wsl' }
        Invoke-Doctor $script:Manifest @{ studio = $null } | Should -Be 1
        Should -Invoke Write-Host -ParameterFilter { "$Object" -match 'POSIX shell' }
    }

    It 'passes with a WSL distro and no Git (positive)' {
        Mock Resolve-ToolCommand { [pscustomobject]@{ Source = $script:WslDistro } } -ParameterFilter { $name -eq 'wsl' }
        Mock Resolve-ToolCommand { $null } -ParameterFilter { $name -ne 'wsl' }
        Invoke-Doctor $script:Manifest @{ studio = $null } | Should -Be 0
    }
}
