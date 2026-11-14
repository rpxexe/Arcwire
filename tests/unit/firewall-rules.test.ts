import { describe, it, expect } from 'vitest';
import { parseNetshRules, evaluateRules } from '../../apps/desktop/electron/services/FirewallService';

const block = (fields: Record<string, string>) =>
  Object.entries({ 'Rule Name': 'x', Enabled: 'Yes', Direction: 'In', Protocol: 'Any', Action: 'Allow', ...fields })
    .map(([k, v]) => `${k}:${' '.repeat(Math.max(1, 38 - k.length))}${v}`)
    .join('\r\n');

const sample = (...blocks: Record<string, string>[]) => '\r\n' + blocks.map(block).join('\r\n\r\n') + '\r\nOk.\r\n';
const EXE = 'C:\\Users\\Me\\AppData\\Local\\Programs\\Arcwire\\Arcwire.exe';

describe('Windows Firewall rule evaluation', () => {
  it('parses netsh verbose output', () => {
    const rules = parseNetshRules(sample({ 'Rule Name': 'Arcwire LAN TCP', Protocol: 'TCP', LocalPort: '45821,45822' }));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ enabled: true, inbound: true, action: 'allow', protocol: 'tcp', localPort: '45821,45822' });
  });

  it('treats a program rule (case-insensitive) as allowed', () => {
    const rules = parseNetshRules(sample({ Program: EXE.toLowerCase() }));
    expect(evaluateRules(rules, EXE, 45821, 45820)).toEqual({ allowed: true, blocked: false });
  });

  it('requires both TCP and UDP port rules, supporting port ranges', () => {
    const tcpOnly = parseNetshRules(sample({ Protocol: 'TCP', LocalPort: '45821-45822' }));
    expect(evaluateRules(tcpOnly, EXE, 45821, 45820).allowed).toBe(false);

    const both = parseNetshRules(
      sample({ Protocol: 'TCP', LocalPort: '45821-45822' }, { Protocol: 'UDP', LocalPort: '45820' })
    );
    expect(evaluateRules(both, EXE, 45821, 45820).allowed).toBe(true);
  });

  it('ignores disabled rules and generic any-port rules, and reports block rules', () => {
    const rules = parseNetshRules(
      sample(
        { Program: EXE, Enabled: 'No' },
        { Protocol: 'TCP', LocalPort: 'Any' },
        { Protocol: 'UDP', LocalPort: 'Any' },
        { Program: EXE, Action: 'Block' }
      )
    );
    expect(evaluateRules(rules, EXE, 45821, 45820)).toEqual({ allowed: false, blocked: true });
  });
});
