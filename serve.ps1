<#
.SYNOPSIS
    Serves this folder over HTTP so Tableau Desktop can load the extension.

.DESCRIPTION
    A dependency-free static file server built on System.Net.HttpListener, for
    machines without Node or Python. Tableau will not load an extension from a
    file:// path, so the folder has to be served even during development.

.PARAMETER Port
    TCP port to listen on. Must match the <url> in daterangepicker.trex.

.EXAMPLE
    .\serve.ps1
    Serves http://localhost:8765/index.html until you press Ctrl+C.

.NOTES
    If the listener fails with "Access is denied", either run this script from
    an elevated PowerShell window, or grant your account a one-time URL
    reservation from an elevated window:

        netsh http add urlacl url=http://localhost:8765/ user=$env:USERDOMAIN\$env:USERNAME

    To remove it later:

        netsh http delete urlacl url=http://localhost:8765/
#>
[CmdletBinding()]
param(
    [int]$Port = 8765,
    [string]$Root
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not populated while parameter defaults are bound under
# "powershell.exe -File", so the folder is resolved here instead, with two
# fallbacks for the invocation styles that leave it empty.
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($Root) -and $MyInvocation.MyCommand.Path) {
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = (Get-Location).ProviderPath
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.trex' = 'application/xml; charset=utf-8'
    '.xml'  = 'application/xml; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.map'  = 'application/json; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
}

$rootFull = (Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
$prefix = "http://localhost:$Port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
}
catch {
    Write-Host "Could not listen on $prefix" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Run this script from an elevated PowerShell window, or reserve the URL once:" -ForegroundColor Yellow
    Write-Host "  netsh http add urlacl url=$prefix user=$env:USERDOMAIN\$env:USERNAME" -ForegroundColor Yellow
    exit 1
}

Write-Host "Serving $rootFull" -ForegroundColor Green
Write-Host "  extension : ${prefix}index.html"
Write-Host "  demo      : ${prefix}demo.html"
Write-Host "  tests     : ${prefix}tests.html"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
            $relative = $relative -replace '/', '\'

            $candidate = Join-Path $rootFull $relative
            $resolved = $null
            if (Test-Path -LiteralPath $candidate) {
                $resolved = (Resolve-Path -LiteralPath $candidate).ProviderPath
            }

            # Refuse anything that escapes the served folder.
            if ($null -eq $resolved -or -not $resolved.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 404
                $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found: /$($relative -replace '\\','/')")
                $response.ContentType = 'text/plain; charset=utf-8'
                $response.ContentLength64 = $body.Length
                $response.OutputStream.Write($body, 0, $body.Length)
                Write-Host ("404  " + $request.Url.AbsolutePath) -ForegroundColor DarkYellow
            }
            else {
                if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
                    $resolved = Join-Path $resolved 'index.html'
                }
                $bytes = [IO.File]::ReadAllBytes($resolved)
                $ext = [IO.Path]::GetExtension($resolved).ToLowerInvariant()
                $response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                $response.Headers['Cache-Control'] = 'no-store'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                Write-Host ("200  " + $request.Url.AbsolutePath) -ForegroundColor DarkGray
            }
        }
        catch {
            $response.StatusCode = 500
            Write-Host ("500  " + $request.Url.AbsolutePath + "  " + $_.Exception.Message) -ForegroundColor Red
        }
        finally {
            $response.OutputStream.Close()
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
    Write-Host "Stopped." -ForegroundColor Green
}
