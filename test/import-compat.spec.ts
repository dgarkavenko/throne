import { describe, expect, it } from 'vitest';
import { ClientGame } from '../src/client/game/client-game';
import { EditorGame } from '../src/client/game/editor-game';
import { SharedGameRuntime } from '../src/client/game/shared-game-runtime';
import * as legacyClientTypes from '../src/client/types';

describe('compatibility shims', () => {
  it('keeps legacy runtime shim paths importable', () => {
    expect(typeof ClientGame).toBe('function');
    expect(typeof EditorGame).toBe('function');
    expect(typeof SharedGameRuntime).toBe('function');
  });

  it('keeps legacy client types shim importable', () => {
    expect(typeof legacyClientTypes).toBe('object');
  });
});
