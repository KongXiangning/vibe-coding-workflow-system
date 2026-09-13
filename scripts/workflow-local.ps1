#requires -Version 7.0
<#
.SYNOPSIS
Build the local distribution and invoke its public install/migrate/upgrade CLI.
.EXAMPLE
.\scripts\workflow-local.ps1 migrate 'E:\coding\my-project'
.EXAMPLE
.\scripts\workflow-local.ps1 migrate 'E:\coding\my-project' -DecisionsFile 'E:\migration-decisions.json'
.EXAMPLE
.\scripts\workflow-local.ps1 migrate 'E:\coding\my-project' -DecisionsFile 'E:\migration-decisions.json' -Execute
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('install', 'migrate', 'upgrade')]
    [string]$Operation,

    [Parameter(Mandatory, Position = 1)]
    [ValidateNotNullOrEmpty()]
    [string]$TargetPath,

    [string]$DecisionsFile,

    # Default is dry-run. Use only after reviewing the dry-run plan.
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$resultCode = 1
$sourceRoot = Split-Path $PSScriptRoot -Parent

try {
    if ($PSBoundParameters.ContainsKey('DecisionsFile') -and $Operation -ne 'migrate') {
        throw 'DecisionsFile is only valid for migrate.'
    }
    # Resolve caller-relative paths before changing the working directory.
    $target = (Resolve-Path -LiteralPath $TargetPath -ErrorAction Stop).ProviderPath
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
        throw 'TargetPath must be an existing project directory.'
    }
    $decisionPath = $null
    if ($DecisionsFile) {
        $decisionPath = (Resolve-Path -LiteralPath $DecisionsFile -ErrorAction Stop).ProviderPath
        if (-not (Test-Path -LiteralPath $decisionPath -PathType Leaf)) {
            throw 'DecisionsFile must be an existing JSON file.'
        }
    }
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $bun = (Get-Command bun -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source

    Push-Location -LiteralPath $sourceRoot
    try {
        foreach ($build in @('build:vnext-runtime', 'build:vibe-governance-distribution')) {
            # Keep stdout for the public CLI's JSON response.
            & $bun run $build | ForEach-Object { [Console]::Error.WriteLine($_) }
            if ($LASTEXITCODE -ne 0) { throw "Build failed: $build (exit $LASTEXITCODE)" }
        }
        $cli = Join-Path $sourceRoot 'packages/vibe-governance/dist/cli.js'
        $cliArgs = @($cli, $Operation.ToLowerInvariant(), '--root', $target, '--json')
        if ($decisionPath) { $cliArgs += @('--decisions-file', $decisionPath) }
        if (-not $Execute) { $cliArgs += '--dry-run' }
        & $node @cliArgs
        $resultCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
exit $resultCode
