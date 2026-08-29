interface LiveEffect {
  readonly cleanup: () => void;
  released: boolean;
}

/** Reverse-order, idempotent ownership for one Surface activation. */
export class ReactSurfaceEffectLedger {
  readonly #effects = new Map<number, LiveEffect[]>();
  readonly #disposed = new Set<number>();
  #nextActivationId = 1;

  begin(): number {
    const activationId = this.#nextActivationId++;
    this.#effects.set(activationId, []);
    return activationId;
  }

  record(activationId: number, cleanup: () => void): void {
    const effects = this.#effects.get(activationId);
    if (!effects || this.#disposed.has(activationId)) {
      throw new Error(
        `Cannot record Surface effect on inactive activation: ${activationId}`,
      );
    }
    effects.push({ cleanup, released: false });
  }

  dispose(activationId: number): void {
    if (this.#disposed.has(activationId)) return;
    this.#disposed.add(activationId);
    const effects = this.#effects.get(activationId) ?? [];
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      if (!effect || effect.released) continue;
      effect.released = true;
      try {
        effect.cleanup();
      } catch {
        // One failed cleanup must not block the remaining owned effects.
      }
    }
  }
}
