// What an admin API record says about each action on it (decided on #19 and #20): allowed, or
// refused with a stable code the console turns into words. An action missing from a record's
// block isn't offered for it in its state.
export type ActionPermission<Code extends string> =
  | { allowed: true }
  | { allowed: false; reason: Code }
