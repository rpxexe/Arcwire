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

export interface ParsedRule {
  enabled: boolean;
  inbound: boolean;
  action: string;
  protocol: string;
  localPort: string;
  program: string;
}

function readNetshInboundRules(): Promise<ParsedRule[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'netsh',
      ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in', 'verbose'],
      { windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(parseNetshRules(stdout));
      }
    );
  });
}

/** Parses `netsh advfirewall firewall show rule ... verbose` (English labels). */
export function parseNetshRules(text: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z ]+):\s*(.*)$/);
      if (m) fields[m[1]!.trim().toLowerCase()] = m[2]!.trim();
    }
    if (!fields['rule name']) continue;
    rules.push({
      enabled: (fields['enabled'] ?? '').toLowerCase() === 'yes',
      inbound: (fields['direction'] ?? '').toLowerCase() === 'in',
      action: (fields['action'] ?? '').toLowerCase(),
      protocol: (fields['protocol'] ?? 'any').toLowerCase(),
      localPort: (fields['localport'] ?? 'any').toLowerCase(),
      program: fields['program'] ?? '',
    });
  }
  return rules;
}

const expandEnv = (value: string) =>
  value.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`);

function coversPort(spec: string, port: number): boolean {
  if (!spec || spec === 'any') return true;
  return spec.split(',').some((part) => {
    const p = part.trim();
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) return port >= Number(range[1]) && port <= Number(range[2]);
    return p === String(port);
  });
}

/** Decides whether inbound Arcwire traffic is allowed / blocked by the given rules. */
export function evaluateRules(
  rules: ParsedRule[],
  executable: string,
  tcp: number,
  udp: number
): { allowed: boolean; blocked: boolean } {
  const exe = executable.toLowerCase();
  const active = rules.filter((r) => r.enabled && r.inbound);
  const forThisApp = (r: ParsedRule) => r.program !== '' && expandEnv(r.program).toLowerCase() === exe;
  const anyProgram = (r: ParsedRule) => r.program === '' || r.program.toLowerCase() === 'any';
  const coversProto = (r: ParsedRule, proto: 'tcp' | 'udp', port: number) =>
    (r.protocol === proto || r.protocol === 'any') && coversPort(r.localPort, port);

  const appAllowed = active.some((r) => r.action === 'allow' && forThisApp(r));
  const portAllowed = (proto: 'tcp' | 'udp', port: number) =>
    active.some((r) => r.action === 'allow' && anyProgram(r) && r.localPort !== 'any' && coversProto(r, proto, port));
  const blocked = active.some(
    (r) =>
      r.action === 'block' &&
      (forThisApp(r) || (anyProgram(r) && r.localPort !== 'any' && (coversProto(r, 'tcp', tcp) || coversProto(r, 'udp', udp))))
  );

  return { allowed: appAllowed || (portAllowed('tcp', tcp) && portAllowed('udp', udp)), blocked };
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
    const networkCategory = await runPowerShell(
      '(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1).NetworkCategory'
    ).catch(() => '');

    // Primary: netsh lists every rule with program and ports, fast and without admin rights
    // (Get-NetFirewallPortFilter is access-denied for standard users).
    try {
      const rules = await readNetshInboundRules();
      if (rules.length > 0) {
        const verdict = evaluateRules(rules, executable, tcp, udp);
        return { supported: true, ...verdict, networkCategory: networkCategory || undefined, executable };
      }
    } catch {
      // fall through to the PowerShell check
    }

    // Fallback (e.g. localized netsh output): program rules via PowerShell, env vars expanded.
    const script = `
$p = ${psQuote(executable)}.ToLowerInvariant()
$inbound = @{}
Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue | ForEach-Object { $inbound[$_.InstanceID] = $_ }
$appRules = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -and $_.Program -ne 'Any' -and ([Environment]::ExpandEnvironmentVariables($_.Program).ToLowerInvariant() -eq $p) } |
  ForEach-Object { $inbound[$_.InstanceID] } | Where-Object { $_ })
"$(@($appRules | Where-Object { $_.Action -eq 'Allow' }).Count)|$(@($appRules | Where-Object { $_.Action -eq 'Block' }).Count)"`;
    try {
      const out = await runPowerShell(script, 60_000);
      const [allow, block] = out.split(/\r?\n/).pop()!.split('|');
      return {
        supported: true,
        allowed: Number(allow) > 0,
        blocked: Number(block) > 0,
        networkCategory: networkCategory || undefined,
        executable,
      };
    } catch (err: any) {
      return {
        supported: true,
        allowed: false,
        blocked: false,
        executable,
        networkCategory: networkCategory || undefined,
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
