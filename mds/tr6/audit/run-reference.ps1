$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourcePath = Join-Path $projectRoot '.audit-sources/Simple606/Source'
$resultPath = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $resultPath | Out-Null

# Extract the actual cymbal specification without pulling in JUCE.
$processor = Get-Content (Join-Path $sourcePath 'PluginProcessor.h') -Raw
$spec = [regex]::Match($processor, '(?s)static constexpr SynthDrums606::HiHatSpec kCymbalSpec = \{.*?\n\};')
if (-not $spec.Success) { throw 'Could not extract cymbal specification.' }
Set-Content -LiteralPath (Join-Path $resultPath 'cymbal_spec.hpp') -Value $spec.Value
Copy-Item -LiteralPath (Join-Path $projectRoot '.audit-sources/Simple606/License.txt') -Destination (Join-Path $resultPath 'Simple606-License.txt')

$compiler = (Get-Command clang++ -ErrorAction Stop).Source
$exePath = Join-Path $resultPath 'reference-render.exe'
$compileArgs = @('-std=c++14', '-O2', '-I', $sourcePath, '-I', $resultPath,
    (Join-Path $PSScriptRoot 'reference_render.cpp'), '-o', $exePath)
& $compiler @compileArgs
if ($LASTEXITCODE -ne 0) { throw 'Reference compilation failed.' }
& $exePath $resultPath | Set-Content -LiteralPath (Join-Path $resultPath 'reference-metrics.csv')
if ($LASTEXITCODE -ne 0) { throw 'Reference rendering failed.' }
Write-Output "Reference results: $resultPath"
