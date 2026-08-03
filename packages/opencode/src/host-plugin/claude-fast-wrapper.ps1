$ErrorActionPreference = "Stop"
$claudeCli = if ($env:HONK_CLAUDE_CLI_PATH) {
  $env:HONK_CLAUDE_CLI_PATH
} elseif ($env:CLAUDE_CLI_PATH) {
  $env:CLAUDE_CLI_PATH
} else {
  "claude"
}

$claudeArgs = [System.Collections.Generic.List[string]]::new()
foreach ($argument in $args) {
  $claudeArgs.Add($argument)
}

function Test-EnvFlagEnabled([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $false
  }
  return @("0", "false", "no", "off") -notcontains $value.Trim().ToLowerInvariant()
}

function Test-VersionAtLeast($version, [int]$major, [int]$minor, [int]$patch) {
  if ($version.Major -ne $major) {
    return $version.Major -gt $major
  }
  if ($version.Minor -ne $minor) {
    return $version.Minor -gt $minor
  }
  return $version.Patch -ge $patch
}

for ($index = 0; $index -lt $claudeArgs.Count - 1; $index++) {
  if ($claudeArgs[$index] -ne "--model") {
    continue
  }

  if ($claudeArgs[$index + 1] -eq "claude-opus-5-fast") {
    $claudeArgs[$index + 1] = "claude-opus-5"
    $claudeArgs.Add("--settings")
    $claudeArgs.Add('{"fastMode":true}')
    break
  }

  if ($claudeArgs[$index + 1] -eq "claude-opus-5") {
    $claudeArgs.Add("--settings")
    $claudeArgs.Add('{"fastMode":false}')
    break
  }
}

# Replace Claude Code's built-in prompt with Pi's AgentHarness default. OpenCode's
# agent system remains in the plugin-provided --append-system-prompt-file.
if ($claudeArgs.Contains("--model")) {
  $claudeArgs.Add("--system-prompt")
  $claudeArgs.Add("You are a helpful assistant.")
}

# Plugin 0.12.0 probes cliPath with shell-less execFile, which cannot launch a .cmd file.
# Mirror its two version-gated headless flags here so Windows keeps the same prompt behavior.
if ($claudeArgs.Contains("--print") -and
    -not (Test-EnvFlagEnabled $env:CLAUDE_CODE_DISABLE_THINKING) -and
    -not (Test-EnvFlagEnabled $env:CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)) {
  $claudeVersion = $null
  try {
    $versionOutput = & $claudeCli --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      $versionMatch = [regex]::Match(($versionOutput -join "`n").Trim(), '(\d+)\.(\d+)\.(\d+)')
      if ($versionMatch.Success) {
        $claudeVersion = [pscustomobject]@{
          Major = [int]$versionMatch.Groups[1].Value
          Minor = [int]$versionMatch.Groups[2].Value
          Patch = [int]$versionMatch.Groups[3].Value
        }
      }
    }
  } catch {
    $claudeVersion = $null
  }

  if ($null -ne $claudeVersion -and
      (Test-VersionAtLeast $claudeVersion 2 0 0) -and
      -not $claudeArgs.Contains("--thinking")) {
    $claudeArgs.Add("--thinking")
    $claudeArgs.Add("enabled")
  }
  if ($null -ne $claudeVersion -and
      (Test-VersionAtLeast $claudeVersion 2 1 142) -and
      ($null -eq [Environment]::GetEnvironmentVariable("CLAUDE_CODE_SHOW_THINKING_SUMMARIES", "Process") -or
       (Test-EnvFlagEnabled $env:CLAUDE_CODE_SHOW_THINKING_SUMMARIES)) -and
      -not $claudeArgs.Contains("--thinking-display")) {
    $claudeArgs.Add("--thinking-display")
    $claudeArgs.Add("summarized")
  }
}

& $claudeCli @claudeArgs
exit $LASTEXITCODE
