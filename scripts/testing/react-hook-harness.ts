import * as React from "react";

type DependencyList = readonly unknown[] | undefined;
type EffectCleanup = void | (() => void);

interface CallbackSlot {
  dependencies: DependencyList;
  value: unknown;
}

interface EffectSlot {
  cleanup: EffectCleanup;
  dependencies: DependencyList;
}

interface ReactInternals {
  H: unknown;
}

function dependenciesMatch(
  previous: DependencyList,
  next: DependencyList,
): boolean {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  );
}

/**
 * Minimal test-only dispatcher for a hook that uses state, callbacks, and
 * effects. It drives the real hook function without adding a DOM dependency.
 */
export function createReactHookHarness<Input, Output>(
  hook: (input: Input) => Output,
): {
  flush: () => Promise<void>;
  render: (input: Input) => Output;
  unmount: () => void;
} {
  const reactWithInternals = React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals;
  };
  const internals = reactWithInternals.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const states: unknown[] = [];
  const callbacks: CallbackSlot[] = [];
  const effects: EffectSlot[] = [];
  const pendingEffects: Array<() => void> = [];
  let cursor = 0;

  const dispatcher = {
    useCallback<T>(callback: T, dependencies: DependencyList): T {
      const index = cursor++;
      const previous = callbacks[index];
      if (previous && dependenciesMatch(previous.dependencies, dependencies)) {
        return previous.value as T;
      }

      callbacks[index] = { dependencies, value: callback };
      return callback;
    },
    useEffect(create: () => EffectCleanup, dependencies: DependencyList): void {
      const index = cursor++;
      const previous = effects[index];
      if (previous && dependenciesMatch(previous.dependencies, dependencies)) {
        return;
      }

      pendingEffects.push(() => {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: create() };
      });
    },
    useState<T>(initialState: T | (() => T)): [T, (next: T | ((value: T) => T)) => void] {
      const index = cursor++;
      if (index === states.length) {
        states.push(
          typeof initialState === "function"
            ? (initialState as () => T)()
            : initialState,
        );
      }

      const setState = (next: T | ((value: T) => T)) => {
        const previous = states[index] as T;
        states[index] =
          typeof next === "function" ? (next as (value: T) => T)(previous) : next;
      };

      return [states[index] as T, setState];
    },
  };

  return {
    async flush(): Promise<void> {
      for (const effect of pendingEffects.splice(0)) {
        effect();
      }

      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
      }
    },
    render(input: Input): Output {
      cursor = 0;
      const previousDispatcher = internals.H;
      internals.H = dispatcher;
      try {
        return hook(input);
      } finally {
        internals.H = previousDispatcher;
      }
    },
    unmount(): void {
      for (const effect of effects) {
        effect?.cleanup?.();
      }
    },
  };
}
