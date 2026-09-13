#requires -Version 7.0
# Compatibility entry; the shared script owns build and public CLI invocation.
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$TargetPath,
    [string]$DecisionsFile,
    [switch]$Execute
)
& (Join-Path $PSScriptRoot 'workflow-local.ps1') -Operation migrate @PSBoundParameters
exit $LASTEXITCODE
