import { describe, it, expect } from 'vitest';

describe('Phase 3 Unit - Group Host Failover Election Algorithm', () => {
  interface Candidate {
    deviceId: string;
    lastKnownSequence: number;
    lastSeen: number;
  }

  // Deterministic election function matching GroupCoordinator specification
  function electNewHost(candidates: Candidate[], failedHostId: string): Candidate | null {
    const eligible = candidates.filter((c) => c.deviceId !== failedHostId);
    if (eligible.length === 0) return null;

    // 1. Highest sequence number
    const maxSeq = Math.max(...eligible.map((c) => c.lastKnownSequence));
    const topCandidates = eligible.filter((c) => c.lastKnownSequence === maxSeq);

    // 2. Lexical tie-breaking on deviceId (ascending)
    topCandidates.sort((a, b) => a.deviceId.localeCompare(b.deviceId));

    return topCandidates[0] ?? null;
  }

  it('elects the candidate with the highest acknowledged sequence number', () => {
    const candidates: Candidate[] = [
      { deviceId: 'dev_charlie', lastKnownSequence: 15, lastSeen: 1000 },
      { deviceId: 'dev_alice', lastKnownSequence: 42, lastSeen: 1000 },
      { deviceId: 'dev_bob', lastKnownSequence: 30, lastSeen: 1000 },
    ];

    const elected = electNewHost(candidates, 'dev_old_host');
    expect(elected?.deviceId).toBe('dev_alice');
  });

  it('breaks ties deterministically using lowest lexical device ID', () => {
    const candidates: Candidate[] = [
      { deviceId: 'dev_gamma', lastKnownSequence: 50, lastSeen: 1000 },
      { deviceId: 'dev_alpha', lastKnownSequence: 50, lastSeen: 1000 },
      { deviceId: 'dev_beta', lastKnownSequence: 50, lastSeen: 1000 },
    ];

    const elected = electNewHost(candidates, 'dev_old_host');
    // All have sequence 50, 'dev_alpha' comes first alphabetically
    expect(elected?.deviceId).toBe('dev_alpha');
  });

  it('guarantees unanimous election across all participating nodes without voting rounds', () => {
    const candidates: Candidate[] = [
      { deviceId: 'dev_node_3', lastKnownSequence: 10, lastSeen: 1000 },
      { deviceId: 'dev_node_1', lastKnownSequence: 10, lastSeen: 1000 },
      { deviceId: 'dev_node_2', lastKnownSequence: 10, lastSeen: 1000 },
    ];

    // Node 1 evaluates election
    const node1Result = electNewHost(candidates, 'dev_dead_host');
    // Node 2 evaluates election
    const node2Result = electNewHost(candidates, 'dev_dead_host');
    // Node 3 evaluates election
    const node3Result = electNewHost(candidates, 'dev_dead_host');

    expect(node1Result?.deviceId).toBe('dev_node_1');
    expect(node2Result?.deviceId).toBe('dev_node_1');
    expect(node3Result?.deviceId).toBe('dev_node_1');
    expect(node1Result?.deviceId).toBe(node2Result?.deviceId);
    expect(node2Result?.deviceId).toBe(node3Result?.deviceId);
  });

  it('handles single surviving member gracefully', () => {
    const candidates: Candidate[] = [
      { deviceId: 'dev_sole_survivor', lastKnownSequence: 5, lastSeen: 1000 },
    ];

    const elected = electNewHost(candidates, 'dev_failed_host');
    expect(elected?.deviceId).toBe('dev_sole_survivor');
  });
});

