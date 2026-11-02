/**
 * Create the machine once, dispose it on unmount, and expose the setters.
 *
 * No `useMemo`: the machine's lifetime is an effect's, not a render's. React Compiler is on
 * in this repo, and a memo here would be both redundant and wrong — a reset of the memo key
 * would build a second machine while the first still holds the pointer state.
 */

import { useEffect, useRef } from "react";

import type { AssetResolver } from "@core/interfaces/animationAssets.ts";
import type { Machine, MachineDefinition } from "@core/models/animationStateMachine.ts";
import { createMachine } from "@core/usecases/animationStateMachine/createMachine.ts";

export interface AnimationMachineHandle {
  /** Current machine, or `null` for the first frame before the effect runs. */
  readonly machine: Machine | null;
  setNumber: (name: string, value: number) => void;
  setBoolean: (name: string, value: boolean) => void;
  fire: (name: string) => void;
  reset: () => void;
  getNumber: (name: string) => number;
  getBoolean: (name: string) => boolean;
}

export interface UseAnimationMachineOptions {
  definition: MachineDefinition;
  resolver: AssetResolver;
  /** Seed for the machine's RNG, so a reload is reproducible. */
  seed?: number;
  onMachine?: (machine: Machine) => void;
}

export function useAnimationMachine(options: UseAnimationMachineOptions): AnimationMachineHandle {
  const ref = useRef<Machine | null>(null);
  const { definition, resolver, seed, onMachine } = options;

  /* The latest-callback ref: `onMachine` must not be an effect dependency (a page passing an
     inline arrow would rebuild the machine on every render, losing its state), and the
     exhaustive-deps rule is right that the effect closes over it — so the effect reads the
     ref instead of the prop. */
  const onMachineRef = useRef(onMachine);
  useEffect(() => {
    onMachineRef.current = onMachine;
  }, [onMachine]);

  useEffect(() => {
    const machine = createMachine(definition, {
      resolver,
      ...(seed == null ? {} : { seed }),
    });
    ref.current = machine;
    onMachineRef.current?.(machine);
    return () => {
      ref.current = null;
      machine.dispose();
    };
    /* `definition` and `resolver` are stable by construction: a module import and a cached
       resolver. `onMachine` is read through `onMachineRef`, deliberately. */
  }, [definition, resolver, seed]);

  return {
    get machine() {
      return ref.current;
    },
    setNumber: (name, value) => ref.current?.setNumber(name, value),
    setBoolean: (name, value) => ref.current?.setBoolean(name, value),
    fire: (name) => ref.current?.fire(name),
    reset: () => ref.current?.reset(),
    getNumber: (name) => ref.current?.getNumber(name) ?? 0,
    getBoolean: (name) => ref.current?.getBoolean(name) ?? false,
  };
}
