import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FirewallStatus } from '@ipm/shared';

const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function runPowerShell(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()));
        else resolve(stdout.trim());
      }
    );
  });
}

/**
 * Inspects and repairs Windows Firewall rules so other LAN devices can reach
 * Arcwire's discovery (UDP) and messaging/calling (TCP) ports.
 */
export class FirewallService {
  constructor(private readonly ports: () => { tcp: number; udp: number; signaling: number }) {}

  private get executable(): string {
    return process.execPath;
  }

  public async getStatus(): Promise<FirewallStatus> {
    const executable = this.executable;
    if (process.platform !== 'win32') {
      return { supported: false, allowed: true, blocked: false, executable };
    }
    const { tcp, udp } = this.ports();
    const script = `
$p = ${psQuote(executable)}
$app = @(Get-NetFirewallApplicationFilter -Program $p -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' })
$allow = @($app | Where-Object { $_.Action -eq 'Allow' }).Count
$block = @($app | Where-Object { $_.Action -eq 'Block' }).Count
$portRules = @(Get-NetFirewallRule -DisplayName 'Arcwire LAN*' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }).Count
$cat = (Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1).NetworkCategory
"$allow|$block|$portRules|$cat"`;
    try {
      const out = await runPowerShell(script);
      const [allow, block, portRules, category] = out.split(/\r?\n/).pop()!.split('|');
      return {
        supported: true,
        allowed: Number(allow) > 0 || Number(portRules) >= 2,
        blocked: Number(block) > 0,
        networkCategory: category || undefined,
        executable,
      };
    } catch (err: any) {
      return {
        supported: true,
        allowed: false,
        blocked: false,
        executable,
        error: `Could not read firewall rules (TCP ${tcp}, UDP ${udp}): ${err?.message ?? err}`,
      };
    }
  }

  /** Adds allow rules (and removes Arcwire-specific block rules) with one UAC prompt. */
  public async fix(): Promise<FirewallStatus> {
    if (process.platform !== 'win32') return this.getStatus();
    const { tcp, udp, signaling } = this.ports();
    const exe = this.executable;

    const elevatedScript = `
$ErrorActionPreference = 'Continue'
$p = ${psQuote(exe)}
Get-NetFirewallApplicationFilter -Program $p -ErrorAction SilentlyContinue |
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
  Where-Object { $_.Action -eq 'Block' } |
  Remove-NetFirewallRule -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName 'Arcwire LAN*' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Arcwire LAN (app)' -Direction Inbound -Program $p -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Arcwire LAN TCP' -Direction Inbound -Protocol TCP -LocalPort ${tcp},${signaling} -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Arcwire LAN UDP' -Direction Inbound -Protocol UDP -LocalPort ${udp} -Action Allow -Profile Any | Out-Null
`;
    const scriptPath = path.join(os.tmpdir(), `arcwire-firewall-${process.pid}.ps1`);
    fs.writeFileSync(scriptPath, elevatedScript, 'utf8');

    try {
      await runPowerShell(
        `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(
          scriptPath
        )}`,
        120_000
      );
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/canceled|cancelled|1223/i.test(msg)) {
        throw new Error('Administrator permission was declined. Firewall rules were not changed.');
      }
      throw new Error(`Could not update Windows Firewall: ${msg}`);
    } finally {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // ignore
      }
    }

    return this.getStatus();
  }
}
